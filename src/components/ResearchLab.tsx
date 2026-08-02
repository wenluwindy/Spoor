import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatAiError } from '../services/ai';
import { getLocaleDirective } from '../utils/aiI18n';
import { parseLenientLlmJson } from '../utils/llmJson';
import { openExternalUrl } from '../utils/openExternal';
import { logger } from '../utils/logger';
import { webSearch, buildSearchContext } from '../services/search';
import { DEFAULT_SEARCH_PROVIDER } from '../constants/searchProviders';
import type { SearchProviderKind } from '../types/aiConfig';
import {
  db,
  type ResearchSession,
  type ResearchSessionSearchStatus,
  type ResearchSessionWebpageSnapshot,
} from '../db';
import {
  Microscope,
  ArrowRight,
  ListChecks,
  Check,
  Loader2,
  FileText,
  Globe,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  LayoutGrid,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { CallAIFn } from '../types/ai';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../services/keyboardLayers';
import { useAppDialog } from './AppDialogProvider';
import { Tooltip } from './ui/Tooltip';
import { ResearchRunView } from './ResearchRunView';
import {
  MAX_RESEARCH_PLAN_STEPS,
  estimateResearchRunCalls,
  parseNeedWebDecision,
  useResearchRun,
} from '../hooks/useResearchRun';

export type ResearchPlanStep = { title: string; desc: string };

/** 只用到取值这一件事，因此不引 i18next 的完整 TFunction 类型。 */
type TranslateFn = (key: string) => string;

/**
 * 计划拆解失败时的兜底步骤。
 *
 * 取 `t` 作为参数而非在模块顶层求值：后者会把文案固定成模块加载时的语言，
 * 用户中途切换语言就不再跟随。
 */
function researchPlanFallback(t: TranslateFn): ResearchPlanStep[] {
  return [1, 2, 3].map((n) => ({
    title: t(`lab.plan_fallback.step${n}_title`),
    desc: t(`lab.plan_fallback.step${n}_desc`),
  }));
}

const RESEARCH_HISTORY_LIMIT = 50;

function formatSessionListDateLabel(createdAt: number, language: string): string {
  const d = new Date(createdAt);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const safeDays = Math.max(0, diffDays);
  const loc = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  try {
    if (safeDays < 7) {
      const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
      if (safeDays === 0) return rtf.format(0, 'day');
      return rtf.format(-safeDays, 'day');
    }
  } catch {
    /* fall through */
  }
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' });
}

function normalizeResearchPlan(raw: unknown): ResearchPlanStep[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchPlanStep[] = [];
  for (const item of raw) {
    if (out.length >= MAX_RESEARCH_PLAN_STEPS) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = String(o.title ?? '').trim();
    const desc = String(o.desc ?? '').trim();
    if (!title && !desc) continue;
    out.push({ title: title || `Step ${out.length + 1}`, desc });
  }
  return out;
}

export type ResearchReportBody = {
  intro: string;
  points: { title: string; text: string }[];
  conclusion: string;
};

/** 执行视图里单步落卡时交给 App 的快照（见 `services/researchStepToCanvas`）。 */
export interface ResearchStepSpawnPayload {
  title: string;
  analysis: string;
  sources: { title: string; link: string; snippet: string }[];
}

export interface ResearchLabProps {
  /** 「落到画布」：把这次研究整块放进当前画布的一个区域框里，然后切过去。 */
  onSpawnToCanvas?: (session: {
    query: string;
    researchPlan: { title: string; desc: string }[];
    researchReport: { intro: string; points: { title: string; text: string }[]; conclusion: string };
  }) => void;
  /**
   * 「中途落卡」：把执行视图里某个已完成步骤落到当前画布（主题卡 + 来源 web 卡），
   * 不切换页签。缺席时执行视图不渲染落卡按钮——与 `onSpawnToCanvas` 同一接线通道。
   */
  onSpawnStepToCanvas?: (step: ResearchStepSpawnPayload) => void | Promise<void>;
  /**
   * 全局搜索跳转（0.5.0 B5）：挂载/变化时打开这条历史会话的报告页。
   * 消费完通过 `onInitialSessionConsumed` 归还——否则下次进实验室又会被拽回同一条。
   */
  initialSessionId?: string | null;
  onInitialSessionConsumed?: () => void;
  aiConfig: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    /** 当前启用的搜索服务与它的 Key，由 `resolveSearchConfig` 压进扁平配置。 */
    searchProvider?: SearchProviderKind;
    searchApiKey?: string;
  };
  callAI: CallAIFn;
}

type WebSearchOutcome = {
  context: string;
  sourceCount: number;
  searchStatus: ResearchSessionSearchStatus;
  webpages: ResearchSessionWebpageSnapshot[];
};

const EMPTY_WEB_OUTCOME: WebSearchOutcome = {
  context: '',
  sourceCount: 0,
  searchStatus: 'idle',
  webpages: [],
};

// ---------------------------------------------------------------------------
// Phase state machine
// ---------------------------------------------------------------------------

type LabPhase = 'idle' | 'planning' | 'plan_ready' | 'researching' | 'completed';

type LabPhaseAction =
  | { type: 'reset' }
  | { type: 'plan_start' }
  | { type: 'plan_ready' }
  | { type: 'run_start' }
  | { type: 'run_completed' }
  | { type: 'open_history' }
  | { type: 'back_to_plan' };

function labPhaseReducer(_phase: LabPhase, action: LabPhaseAction): LabPhase {
  switch (action.type) {
    case 'reset':
      return 'idle';
    case 'plan_start':
      return 'planning';
    case 'plan_ready':
    case 'back_to_plan':
      return 'plan_ready';
    case 'run_start':
      return 'researching';
    case 'run_completed':
    case 'open_history':
      return 'completed';
    default:
      return _phase;
  }
}

export function ResearchLab({
  aiConfig,
  callAI,
  onSpawnToCanvas,
  onSpawnStepToCanvas,
  initialSessionId,
  onInitialSessionConsumed,
}: ResearchLabProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const [phase, dispatchPhase] = useReducer(labPhaseReducer, 'idle');
  const [query, setQuery] = useState('');
  const [researchPlan, setResearchPlan] = useState<ResearchPlanStep[]>([]);
  const [researchReport, setResearchReport] = useState<ResearchReportBody>({
    intro: '', points: [], conclusion: ''
  });
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'fallback'>('idle');
  const [sourceCount, setSourceCount] = useState(0);
  const [planRevisionNote, setPlanRevisionNote] = useState('');
  const [planRevising, setPlanRevising] = useState(false);
  /** Raw model output while generating outline (streaming when provider supports it). */
  const [planStreamText, setPlanStreamText] = useState('');
  const [searchSources, setSearchSources] = useState<ResearchSessionWebpageSnapshot[]>([]);
  const [sourceDetail, setSourceDetail] = useState<ResearchSessionWebpageSnapshot | null>(null);
  const executeResearchInFlightRef = useRef(false);
  /** When a search key is set: classifier result for current session; null = not classified yet. */
  const labNeedWebRef = useRef<boolean | null>(null);

  const translateForRun = useCallback(
    (key: string, opts?: Record<string, unknown>) => String(t(key, opts as never)),
    [t],
  );
  const run = useResearchRun({ aiConfig, callAI, translate: translateForRun });

  const pastSessions = useLiveQuery(
    () => db.researchSessions.orderBy('createdAt').reverse().limit(RESEARCH_HISTORY_LIMIT).toArray(),
    []
  ) ?? [];

  // 来源详情是遮罩弹层，按 modal 级占键盘层（见 keyboardLayers）
  useEffect(() => {
    if (!sourceDetail) return;
    const releaseLayer = acquireKeyboardLayer('modal');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopKeyboardLayer('modal')) setSourceDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      releaseLayer();
    };
  }, [sourceDetail]);

  const openHistorySession = (session: ResearchSession) => {
    setQuery(session.query);
    setResearchPlan(normalizeResearchPlan(session.researchPlan));
    setResearchReport({
      intro: session.researchReport.intro,
      points: session.researchReport.points ?? [],
      conclusion: session.researchReport.conclusion,
    });
    setSourceCount(session.sourceCount);
    setSearchStatus(session.searchStatus);
    setSearchSources(session.searchWebpages ?? []);
    labNeedWebRef.current = null;
    run.reset();
    dispatchPhase({ type: 'open_history' });
  };

  /** 全局搜索跳进来：按 id 打开那条历史。查不到（已删）就静默归还，停在大纲页。 */
  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    void db.researchSessions.get(initialSessionId).then((session) => {
      if (cancelled) return;
      if (session) openHistorySession(session);
      onInitialSessionConsumed?.();
    });
    return () => {
      cancelled = true;
    };
    // openHistorySession 每次渲染都是新引用，按 id 触发即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  const deleteResearchSession = async (sessionId: string) => {
    const ok = await confirm({
      message: t('lab.delete_session_confirm'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await db.researchSessions.delete(sessionId);
    } catch (e) {
      logger.error('research', 'ResearchLab delete session failed', formatAiError(e));
    }
  };

  const classifyNeedWebSearch = async (searchQuery: string): Promise<boolean> => {
    try {
      const prompt = t('lab.ai_need_web_classifier', { query: searchQuery });
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
      });
      return parseNeedWebDecision(String(text ?? ''));
    } catch (e) {
      logger.warn('research', 'ResearchLab need_web classification failed', formatAiError(e));
      return true;
    }
  };

  /**
   * If a search key is set: run lightweight classifier once per session start; only search when need_web.
   * If no key: no classifier; returns empty outcome (same as before).
   */
  const resolveWebSearchOutcome = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.searchApiKey?.trim();
    if (!apiKey) {
      return tryWebSearch(searchQuery);
    }
    const needWeb = await classifyNeedWebSearch(searchQuery);
    labNeedWebRef.current = needWeb;
    if (!needWeb) {
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);
      return { ...EMPTY_WEB_OUTCOME };
    }
    return tryWebSearch(searchQuery);
  };

  /**
   * Attempt a web search with the active provider; returns context string and status
   * for prompts and persistence.
   */
  const tryWebSearch = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.searchApiKey?.trim();
    if (!apiKey) {
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'idle', webpages: [] };
    }

    setSearchStatus('searching');
    try {
      const results = await webSearch(searchQuery, {
        kind: aiConfig.searchProvider ?? DEFAULT_SEARCH_PROVIDER,
        apiKey,
      });
      const context = buildSearchContext(results);
      const webpages = (results.webpages ?? []).map((w) => ({
        title: String(w.title ?? ''),
        link: String(w.link ?? ''),
        snippet: String(w.snippet ?? ''),
      }));
      if (context) {
        const count = webpages.length;
        setSourceCount(count);
        setSearchStatus('found');
        setSearchSources(webpages);
        return { context, sourceCount: count, searchStatus: 'found', webpages };
      }
      setSearchStatus('fallback');
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'fallback', webpages: [] };
    } catch (e) {
      logger.warn('research', 'Metaso search failed, degrading to offline mode', formatAiError(e));
      setSearchStatus('fallback');
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'fallback', webpages: [] };
    }
  };

  const generatePlan = async () => {
    dispatchPhase({ type: 'plan_start' });
    setSearchStatus('idle');
    setSearchSources([]);
    setSourceDetail(null);
    setPlanRevisionNote('');
    labNeedWebRef.current = null;
    setPlanStreamText('');
    run.reset();

    const { context: searchContext } = await resolveWebSearchOutcome(query);

    try {
      const prompt = searchContext
        ? `${t('lab.ai_decompose_question', { query })}\n\nAdditionally, here are web search results that may inform your plan:\n\n${searchContext}`
        : t('lab.ai_decompose_question', { query });

      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
        onStreamChunk: (acc) => setPlanStreamText(acc),
      });
      const plan = normalizeResearchPlan(parseLenientLlmJson(text ?? '[]'));
      setResearchPlan(plan.length > 0 ? plan : researchPlanFallback(t));
      setPlanStreamText('');
      dispatchPhase({ type: 'plan_ready' });
    } catch (e) {
      logger.error('research', 'ResearchLab generatePlan failed', formatAiError(e));
      setPlanStreamText('');
      setResearchPlan(researchPlanFallback(t));
      dispatchPhase({ type: 'plan_ready' });
    }
  };

  const updatePlanItem = (idx: number, field: 'title' | 'desc', value: string) => {
    setResearchPlan(prev => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const revisePlanWithAi = async () => {
    const instruction = planRevisionNote.trim();
    if (!instruction || planRevising || researchPlan.length === 0) return;

    setPlanRevising(true);
    setPlanStreamText('');
    try {
      const prompt = t('lab.ai_revise_decompose', {
        query,
        plan: JSON.stringify(researchPlan, null, 2),
        instruction,
      });
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
        onStreamChunk: (acc) => setPlanStreamText(acc),
      });
      const revised = normalizeResearchPlan(parseLenientLlmJson(text ?? '[]'));
      if (revised.length > 0) {
        setResearchPlan(revised);
        setPlanRevisionNote('');
      }
      setPlanStreamText('');
    } catch (e) {
      logger.error('research', 'ResearchLab revisePlan failed', formatAiError(e));
      setPlanStreamText('');
    } finally {
      setPlanRevising(false);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    generatePlan();
  };

  /**
   * 真分步执行：编排在 useResearchRun 里；这里只负责 phase 切换、
   * 把最终结果同步进侧栏状态，以及 completed 时落库。
   * aborted / failed 停留在执行视图，已完成步骤的产出保留在界面上（不落库）。
   */
  const executeResearch = async () => {
    if (executeResearchInFlightRef.current) return;
    executeResearchInFlightRef.current = true;
    try {
      dispatchPhase({ type: 'run_start' });
      setSourceDetail(null);
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);

      const result = await run.start(query, researchPlan, labNeedWebRef.current);
      labNeedWebRef.current = result.needWebResolved;
      setSearchStatus(result.searchStatus);
      setSourceCount(result.sourceCount);
      setSearchSources(result.webpages);

      if (result.status !== 'completed' || !result.report) return;

      setResearchReport(result.report);
      try {
        const now = Date.now();
        await db.researchSessions.add({
          id: crypto.randomUUID(),
          query,
          createdAt: now,
          updatedAt: now,
          researchPlan: researchPlan
            .slice(0, MAX_RESEARCH_PLAN_STEPS)
            .map((s) => ({ title: s.title, desc: s.desc })),
          researchReport: {
            intro: result.report.intro ?? '',
            points: result.report.points.map((p) => ({
              title: String(p?.title ?? ''),
              text: String(p?.text ?? ''),
            })),
            conclusion: result.report.conclusion ?? '',
          },
          sourceCount: result.sourceCount,
          searchStatus: result.searchStatus,
          searchWebpages: result.webpages,
        });
      } catch (persistErr) {
        logger.error('research', 'ResearchLab failed to persist session', persistErr);
      }
      dispatchPhase({ type: 'run_completed' });
    } finally {
      executeResearchInFlightRef.current = false;
    }
  };

  const backToPlan = () => {
    run.reset();
    setSourceDetail(null);
    dispatchPhase({ type: 'back_to_plan' });
  };

  /**
   * 中途落卡（roadmap C10）：把执行视图里某个已完成步骤的产出交给 App 落到当前画布。
   * 只做快照与转发——布局、落库、撤销都在 App 一侧（`researchStepToCanvas` + `canvasMutations`）。
   */
  const spawnStepToCanvas = useCallback(
    async (stepIndex: number) => {
      if (!onSpawnStepToCanvas) return;
      const step = run.state.steps[stepIndex];
      if (!step || step.status !== 'done') return;
      await onSpawnStepToCanvas({
        title: step.title,
        analysis: step.analysis,
        sources: step.sources.map((s) => ({
          title: s.title,
          link: s.link,
          snippet: s.snippet,
        })),
      });
    },
    [onSpawnStepToCanvas, run.state.steps],
  );

  /** 历史会话续跑：query 和 plan 已在状态里，回到大纲页让用户改后重跑。 */
  const rebaseFromSession = () => {
    labNeedWebRef.current = null;
    run.reset();
    setSourceDetail(null);
    setPlanRevisionNote('');
    setPlanStreamText('');
    dispatchPhase({ type: 'back_to_plan' });
  };

  const resetToIdle = () => {
    dispatchPhase({ type: 'reset' });
    setQuery('');
    setSearchStatus('idle');
    setSourceCount(0);
    setSearchSources([]);
    setSourceDetail(null);
    labNeedWebRef.current = null;
    setPlanStreamText('');
    run.reset();
  };

  // ---- 侧栏：执行中来源实时来自各步骤（按 link 去重），其余阶段用会话级快照 ----
  const runMergedSources = useMemo(() => {
    const seen = new Map<string, ResearchSessionWebpageSnapshot>();
    for (const step of run.state.steps) {
      for (const wp of step.sources) {
        if (wp.link && !seen.has(wp.link)) seen.set(wp.link, wp);
      }
    }
    return [...seen.values()];
  }, [run.state.steps]);

  const runSearchInFlight = run.state.steps.some(
    (s) => s.status === 'searching' || s.status === 'querying',
  );
  const sidebarSources = phase === 'researching' ? runMergedSources : searchSources;
  const sidebarStatus: 'idle' | 'searching' | 'found' | 'fallback' =
    phase === 'researching'
      ? runSearchInFlight
        ? 'searching'
        : runMergedSources.length > 0
          ? 'found'
          : 'idle'
      : searchStatus;
  const sidebarCount = phase === 'researching' ? runMergedSources.length : sourceCount;

  // ---- 成本预估（执行前显示在按钮附近） ----
  const searchKeySet = Boolean(aiConfig.searchApiKey?.trim());
  const willSearch = searchKeySet && labNeedWebRef.current !== false;
  const runEstimate = estimateResearchRunCalls(
    researchPlan.length,
    willSearch,
    searchKeySet && labNeedWebRef.current === null,
  );
  const costEstimateLabel = willSearch
    ? t('lab.estimated_calls_with_search', {
        llm: runEstimate.llmCalls,
        search: runEstimate.searchCalls,
      })
    : t('lab.estimated_calls_no_search', { llm: runEstimate.llmCalls });

  return (
    <div className="flex-1 flex min-h-0 bg-app-surface paper-texture text-app-text overflow-hidden">
      {/* Side Panel: History & Status */}
      <div className="w-64 border-r border-app-border flex flex-col bg-app-surface-subtle/50 z-10 shrink-0">
        <div className="flex-1 overflow-y-auto p-4">
           {phase === 'idle' ? (
             <>
               <h3 className="font-sans text-xs font-bold text-app-text-faint uppercase tracking-wider mb-4">{t('lab.past_sessions')}</h3>
               {pastSessions.length === 0 ? (
                 <p className="text-xs text-app-text-faint font-sans leading-relaxed">{t('lab.no_past_sessions')}</p>
               ) : (
                 <div className="space-y-2">
                   {pastSessions.map((session) => (
                     <div
                       key={session.id}
                       className="flex gap-0 rounded-lg border border-app-border bg-app-surface-raised shadow-sm overflow-hidden hover:border-app-accent/45 transition-colors"
                     >
                       <button
                         type="button"
                         data-testid={`research-session-${session.id}`}
                         onClick={() => openHistorySession(session)}
                         className="flex-1 min-w-0 text-left p-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent/25"
                       >
                         <div className="text-app-text-faint text-[10px] mb-1 font-sans">
                           {formatSessionListDateLabel(session.createdAt, i18n.language)}
                         </div>
                         <div className="text-sm font-sans font-medium text-app-text line-clamp-3">{session.query}</div>
                       </button>
                       <button
                         type="button"
                         data-testid={`research-session-delete-${session.id}`}
                         aria-label={t('lab.delete_session')}
                         title={t('lab.delete_session')}
                         onClick={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           void deleteResearchSession(session.id);
                         }}
                         className="shrink-0 px-2.5 flex items-center justify-center border-l border-app-border text-app-text-faint hover:bg-[#FEF2F2] hover:text-[#b91c1c] transition-colors"
                       >
                         <Trash2 className="w-4 h-4" aria-hidden />
                       </button>
                     </div>
                   ))}
                 </div>
               )}
             </>
           ) : (
             <>
               <div className="flex justify-between items-center mb-4">
                 <span className="font-mono text-xs text-app-text-faint uppercase font-bold tracking-wider">{t('lab.sources_utilized')}</span>
                 {phase === 'completed' && (
                   <button
                     type="button"
                     onClick={resetToIdle}
                     className="text-app-accent text-xs hover:underline font-bold"
                   >
                     {t('lab.new_research')}
                   </button>
                 )}
               </div>

               {/* Search status indicator */}
               {sidebarStatus === 'searching' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-app-accent/30 rounded text-xs flex items-center gap-2 text-app-accent font-mono">
                   <Globe className="w-3 h-3 animate-pulse" />
                   <span>{t('lab.searching')}</span>
                 </div>
               )}
               {sidebarStatus === 'found' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-[#4ade80]/30 rounded text-xs flex items-center gap-2 text-[#16a34a] font-mono">
                   <Globe className="w-3 h-3" />
                   <span>{t('lab.search_complete', { count: sidebarCount })}</span>
                 </div>
               )}
               {sidebarStatus === 'fallback' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-[#eab308]/30 rounded text-xs flex items-center gap-2 text-[#a16207] font-mono">
                   <AlertTriangle className="w-3 h-3" />
                   <span>{t('lab.search_fallback')}</span>
                 </div>
               )}

               <div className="space-y-3">
                 {sidebarSources.length > 0 ? (
                   sidebarSources.map((wp, idx) => {
                     const cardShell =
                       'w-full text-left bg-app-surface-raised border border-app-border p-3 rounded-lg text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/30 hover:border-app-accent/45 hover:shadow-md cursor-pointer';
                     return (
                       <button
                         key={`${wp.link}-${idx}`}
                         type="button"
                         data-testid={`lab-source-card-${idx}`}
                         aria-label={t('lab.source_view_detail')}
                         onClick={() => setSourceDetail(wp)}
                         className={cardShell}
                       >
                         <div className="text-[10px] text-[#4ade80] mb-1 font-mono flex items-center gap-1 font-bold">
                           <Check className="w-3 h-3 shrink-0" aria-hidden />
                           {t('lab.processed')}
                         </div>
                         <div className="flex items-start justify-between gap-2">
                           <span className="text-app-text font-serif font-bold leading-snug line-clamp-3">
                             {wp.title?.trim() || wp.link || t('lab.source_untitled')}
                           </span>
                           <ExternalLink className="w-4 h-4 shrink-0 text-app-text-faint mt-0.5" aria-hidden />
                         </div>
                         {wp.snippet?.trim() ? (
                           <p className="text-app-text-muted text-xs mt-2 font-sans leading-relaxed line-clamp-4">
                             {wp.snippet.trim()}
                           </p>
                         ) : null}
                       </button>
                     );
                   })
                 ) : (
                   <p className="text-[11px] text-app-text-faint font-sans leading-relaxed px-0.5">{t('lab.sources_none_hint')}</p>
                 )}
               </div>
             </>
           )}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
         {phase === 'idle' && (
           <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-3xl mx-auto w-full">
               <div className="w-16 h-16 bg-app-surface-raised border border-app-border shadow-sm rounded-2xl flex items-center justify-center mb-8">
                <Microscope className="w-8 h-8 text-app-accent" />
              </div>
              <h1 className="text-4xl font-serif font-bold mb-4 text-center text-app-text">{t('lab.investigate')}</h1>
              <p className="text-app-text-muted text-center mb-8 font-sans text-lg">
                 {t('lab.idle_intro')}
              </p>

              <form onSubmit={handleStart} className="w-full relative group">
                 <div className="absolute -inset-1 bg-gradient-to-r from-app-accent/20 to-app-accent/0 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                 <input
                   type="text"
                   value={query}
                   onChange={e => setQuery(e.target.value)}
                   placeholder={t('lab.placeholder')}
                   className="relative w-full bg-app-surface-raised border border-app-border text-app-text pl-6 pr-16 py-4 rounded-xl font-sans focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent shadow-lg text-lg placeholder-app-text-faint"
                   autoFocus
                 />
                 <Tooltip label={t('lab.start_research')}>
                   <button
                     type="submit"
                     className={`absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${query.trim() ? 'bg-app-accent text-white hover:bg-app-accent-hover shadow-md' : 'bg-app-surface-subtle text-app-text-faint cursor-not-allowed border border-app-border'}`}
                   >
                     <ArrowRight className="w-5 h-5" />
                   </button>
                 </Tooltip>
              </form>

              <div className="mt-8 flex gap-3 text-xs font-mono text-app-text-muted">
                 <span className="bg-app-surface-raised px-3 py-1 rounded-full border border-app-border shadow-sm">{t('lab.suggested_tag_1')}</span>
                 <span className="bg-app-surface-raised px-3 py-1 rounded-full border border-app-border shadow-sm">{t('lab.suggested_tag_2')}</span>
              </div>
           </div>
         )}

         {(phase === 'planning' || phase === 'plan_ready') && (
           <div className="flex-1 p-12 overflow-y-auto w-full max-w-5xl mx-auto">
              <div className="mb-8 border-b border-app-border pb-8">
                 <div className="text-app-accent font-mono text-xs mb-2">{t('lab.target_inquiry')}</div>
                 {phase === 'plan_ready' ? (
                   <input
                     type="text"
                     value={query}
                     onChange={(e) => setQuery(e.target.value)}
                     aria-label={t('lab.target_inquiry')}
                     placeholder={t('lab.placeholder')}
                     data-testid="lab-query-input"
                     className="w-full bg-transparent text-3xl font-serif font-bold text-app-text placeholder-app-text-faint border-b border-transparent hover:border-app-border focus:border-app-accent focus:outline-none transition-colors"
                   />
                 ) : (
                   <h2 className="text-3xl font-serif font-bold text-app-text">{query}</h2>
                 )}
              </div>

              <div className="bg-app-surface-raised border border-app-border shadow-md rounded-xl p-8 relative overflow-hidden">
                {phase === 'planning' && (
                  <div className="space-y-4">
                    {planStreamText ? (
                      <div className="space-y-2">
                        <p className="text-xs text-app-text-faint font-sans leading-relaxed">{t('lab.plan_stream_hint')}</p>
                        <pre className="max-h-[min(420px,55vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-app-text bg-app-surface border border-app-border rounded-lg p-4">
                          {planStreamText}
                        </pre>
                      </div>
                    ) : null}
                    <div className={`flex flex-col items-center justify-center gap-3 ${planStreamText ? 'py-6' : 'py-12'}`}>
                      <Loader2 className="w-8 h-8 text-app-accent animate-spin" aria-hidden />
                      <div className="font-mono text-sm text-app-text-faint text-center px-2">
                        {searchStatus === 'searching'
                          ? t('lab.searching')
                          : planStreamText
                            ? t('lab.plan_stream_status')
                            : t('nodes.ai_loading')}
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'plan_ready' && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                     <div className="flex items-center gap-3 mb-2">
                        <ListChecks className="w-6 h-6 text-[#4ade80]" />
                        <h3 className="text-xl font-sans font-bold text-app-text">{t('lab.recommended_plan_title')}</h3>
                     </div>
                     <p className="text-app-text-muted text-sm font-sans mb-6">{t('lab.plan_edit_hint')}</p>

                     {planRevising && planStreamText ? (
                       <pre className="mb-6 max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-app-text bg-app-surface border border-app-border rounded-lg p-4">
                         {planStreamText}
                       </pre>
                     ) : null}

                     <div className="space-y-5 mb-8">
                        {researchPlan.length > 0 ? researchPlan.map((plan, idx) => (
                           <div key={idx} className="flex gap-4">
                              <div className="w-6 h-6 rounded-full bg-app-surface-subtle border border-app-border flex items-center justify-center font-mono text-xs text-app-text-muted shrink-0 font-bold mt-2">{idx + 1}</div>
                              <div className="flex-1 min-w-0 space-y-2">
                                 <input
                                   type="text"
                                   value={plan.title}
                                   onChange={e => updatePlanItem(idx, 'title', e.target.value)}
                                   disabled={planRevising}
                                   className="w-full font-bold text-app-text text-base bg-app-surface border border-app-border rounded-lg px-3 py-2 font-sans focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent disabled:opacity-60"
                                   aria-label={`Step ${idx + 1} title`}
                                 />
                                 <textarea
                                   value={plan.desc}
                                   onChange={e => updatePlanItem(idx, 'desc', e.target.value)}
                                   disabled={planRevising}
                                   rows={4}
                                   className="w-full text-app-text-muted text-sm bg-app-surface border border-app-border rounded-lg px-3 py-2 font-sans leading-relaxed resize-y min-h-[5rem] focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent disabled:opacity-60"
                                   aria-label={`Step ${idx + 1} description`}
                                 />
                              </div>
                           </div>
                        )) : (
                           <div className="text-center text-app-text-muted">{t('lab.plan_stream_status')}</div>
                        )}
                     </div>

                     <div className="border-t border-app-border pt-6 space-y-3">
                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            void revisePlanWithAi();
                          }}
                          className="space-y-3"
                        >
                           <textarea
                             value={planRevisionNote}
                             onChange={e => setPlanRevisionNote(e.target.value)}
                             disabled={planRevising || researchPlan.length === 0}
                             rows={3}
                             placeholder={t('lab.plan_revision_placeholder')}
                             className="w-full text-app-text text-sm bg-app-surface border border-app-border rounded-lg px-4 py-3 font-sans placeholder:text-app-text-faint focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent disabled:opacity-60 resize-y min-h-[5.5rem]"
                           />
                           <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="submit"
                                disabled={planRevising || !planRevisionNote.trim() || researchPlan.length === 0}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-sans text-sm font-bold border border-app-border bg-app-surface-raised text-app-text hover:border-app-accent/60 hover:bg-app-accent-wash disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-sm"
                              >
                                {planRevising ? <Loader2 className="w-4 h-4 animate-spin text-app-accent" /> : <Sparkles className="w-4 h-4 text-app-accent" />}
                                {planRevising ? t('lab.plan_revision_applying') : t('lab.plan_revision_apply')}
                              </button>
                           </div>
                        </form>
                     </div>

                     <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-app-border mt-6">
                        <p className="font-mono text-xs text-app-text-muted" data-testid="lab-cost-estimate">
                          {costEstimateLabel}
                        </p>
                        <button
                          type="button"
                          onClick={() => void executeResearch()}
                          disabled={planRevising || researchPlan.length === 0 || !query.trim()}
                          className="bg-app-accent hover:bg-app-accent-hover disabled:opacity-50 disabled:pointer-events-none text-white px-6 py-3 rounded-lg font-sans font-bold transition-all shadow-md flex items-center gap-2"
                        >
                          {t('lab.approve')} <ArrowRight className="w-4 h-4" />
                        </button>
                     </div>
                  </div>
                )}
              </div>
           </div>
         )}

         {phase === 'researching' && (
           <ResearchRunView
             run={run.state}
             onStop={run.stop}
             onRetry={() => void executeResearch()}
             onBackToPlan={backToPlan}
             onShowSource={setSourceDetail}
             onSpawnStep={onSpawnStepToCanvas ? spawnStepToCanvas : undefined}
           />
         )}

         {phase === 'completed' && (
            <div className="flex-1 flex overflow-hidden">
               {/* Final Report */}
               <div className="flex-1 bg-app-surface text-app-text overflow-y-auto relative paper-texture">
                     <div className="max-w-5xl mx-auto px-16 py-14">
                     <div className="mb-8 flex flex-wrap justify-end gap-3">
                       <button
                         type="button"
                         data-testid="lab-rebase-session"
                         onClick={rebaseFromSession}
                         className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-surface-raised px-4 py-2 text-sm font-bold text-app-text shadow-sm hover:border-app-accent/50 hover:text-app-accent transition-colors"
                       >
                         <RotateCcw className="w-4 h-4" aria-hidden />
                         {t('lab.rebase_from_session')}
                       </button>
                       {onSpawnToCanvas && (
                         <button
                           type="button"
                           data-testid="lab-spawn-to-canvas"
                           onClick={() =>
                             onSpawnToCanvas({
                               query,
                               researchPlan: researchPlan.map((s) => ({ title: s.title, desc: s.desc })),
                               researchReport,
                             })
                           }
                           className="inline-flex items-center gap-2 rounded-lg border border-app-accent/40 bg-app-accent/5 px-4 py-2 text-sm font-bold text-app-accent hover:bg-app-accent/10 transition-colors"
                         >
                           <LayoutGrid className="w-4 h-4" />
                           {t('lab.spawn_to_canvas')}
                         </button>
                       )}
                     </div>
                     <div className="mb-12 text-center">
                        <div className="text-app-accent font-mono text-xs uppercase tracking-widest mb-4 flex items-center justify-center gap-2 font-bold">
                          <FileText className="w-4 h-4" /> {t('lab.report')}
                        </div>
                        <h1 className="font-serif text-[44px] font-bold leading-tight mb-4">{query || t('lab.report')}</h1>
                        <div className="h-0.5 w-20 bg-app-text mx-auto"></div>
                        {searchStatus === 'found' && (
                          <p className="text-xs text-app-text-faint mt-3 font-mono">{t('lab.report_footer_web', { count: sourceCount })}</p>
                        )}
                        {searchStatus === 'fallback' && (
                          <p className="text-xs text-[#a16207] mt-3 font-mono">{t('lab.report_footer_offline')}</p>
                        )}
                     </div>

                     <div className="font-serif text-[19px] leading-[1.9] text-app-text space-y-7">
                        <p>{researchReport.intro}</p>

                        {researchReport.points?.map((pt, idx) => (
                           <React.Fragment key={idx}>
                              <h3 className="font-sans font-bold text-[22px] mt-10 mb-4">{idx + 1}. {pt.title}</h3>
                              <p>{pt.text}</p>
                           </React.Fragment>
                        ))}

                        <div className="bg-[#fff9e6] border-l-4 border-app-accent p-5 text-app-text-muted font-sans text-sm my-8 shadow-sm rounded-r">
                           <strong className="text-app-text">{t('lab.conclusion_label')}</strong> {researchReport.conclusion}
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         )}
      </div>

      {sourceDetail ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          data-testid="lab-source-detail-modal"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSourceDetail(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lab-source-detail-title"
            className="flex max-h-[min(560px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-app-border bg-app-surface-raised px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-app-accent">{t('lab.source_detail_heading')}</p>
                <h2 id="lab-source-detail-title" className="mt-1 font-serif text-lg font-bold leading-snug text-app-text">
                  {sourceDetail.title?.trim() || sourceDetail.link || t('lab.source_untitled')}
                </h2>
              </div>
              <button
                type="button"
                aria-label={t('settings.close')}
                className="shrink-0 rounded-lg p-1.5 text-app-text-faint transition-colors hover:bg-app-surface-subtle hover:text-app-text"
                onClick={() => setSourceDetail(null)}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="text-xs leading-relaxed text-app-text-muted">{t('lab.source_modal_hint')}</p>
              {sourceDetail.snippet?.trim() ? (
                <p className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-app-text">{sourceDetail.snippet.trim()}</p>
              ) : null}
              {sourceDetail.link?.trim() ? (
                <p className="mt-4 break-all font-mono text-[11px] text-app-text-faint">{sourceDetail.link.trim()}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-app-border bg-app-surface-raised px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-app-border bg-app-surface-raised px-4 py-2 text-sm font-bold text-app-text shadow-sm hover:bg-app-surface"
                onClick={() => setSourceDetail(null)}
              >
                {t('settings.close')}
              </button>
              {sourceDetail.link?.trim() && /^https?:\/\//i.test(sourceDetail.link.trim()) ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-app-accent px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-app-accent-hover"
                  onClick={() => {
                    void openExternalUrl(sourceDetail.link).catch((err) =>
                      logger.error('research', 'openExternalUrl failed', err),
                    );
                  }}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  {t('lab.open_in_system_browser')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
