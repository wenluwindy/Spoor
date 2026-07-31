import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatAiError } from '../services/ai';
import { getLocaleDirective } from '../utils/aiI18n';
import { parseLenientLlmJson } from '../utils/llmJson';
import { openExternalUrl } from '../utils/openExternal';
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
  Terminal,
  Microscope,
  ArrowRight,
  ListChecks,
  Check,
  CheckCircle2,
  Loader2,
  FileText,
  Globe,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';
import type { CallAIFn } from '../types/ai';
import { useAppDialog } from './AppDialogProvider';
import { Tooltip } from './ui/Tooltip';

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

function normalizeResearchReport(raw: unknown): ResearchReportBody {
  if (!raw || typeof raw !== 'object') {
    return { intro: '', points: [], conclusion: '' };
  }
  const o = raw as Record<string, unknown>;
  const intro = String(o.intro ?? '').trim();
  const conclusion = String(o.conclusion ?? '').trim();
  const points: { title: string; text: string }[] = [];
  if (Array.isArray(o.points)) {
    for (const p of o.points) {
      if (!p || typeof p !== 'object') continue;
      const rec = p as Record<string, unknown>;
      points.push({
        title: String(rec.title ?? '').trim(),
        text: String(rec.text ?? '').trim(),
      });
    }
  }
  return { intro, points, conclusion };
}

/** 报告 JSON 解析失败时展示的说明（不是研究结果，只是告知失败原因）。 */
function researchReportParseFallback(t: TranslateFn): ResearchReportBody {
  return {
    intro: t('lab.parse_error_report.intro'),
    points: [
      {
        title: t('lab.parse_error_report.point_title'),
        text: t('lab.parse_error_report.point_text'),
      },
    ],
    conclusion: t('lab.parse_error_report.conclusion'),
  };
}

export interface ResearchLabProps {
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

/** Parse `{"need_web":boolean}` from classifier output; default true if ambiguous (prefer fetching sources). */
function parseNeedWebDecision(text: string): boolean {
  try {
    const raw = parseLenientLlmJson(text ?? '');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>).need_web;
      if (v === true) return true;
      if (v === false) return false;
    }
  } catch {
    /* fall through */
  }
  return true;
}

export function ResearchLab({ aiConfig, callAI }: ResearchLabProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const [phase, setPhase] = useState<'idle' | 'planning' | 'plan_ready' | 'researching' | 'completed'>('idle');
  const [query, setQuery] = useState('');
  /** Real execute pipeline: await resolveWebSearchForExecute → await callAI(report). */
  const [researchExecStage, setResearchExecStage] = useState<'resolving_context' | 'generating_report'>(
    'resolving_context',
  );
  const [researchPlan, setResearchPlan] = useState<ResearchPlanStep[]>([]);
  const [researchReport, setResearchReport] = useState<{intro: string, points: {title: string, text: string}[], conclusion: string}>({
    intro: '', points: [], conclusion: ''
  });
  const [reportGenerationFailed, setReportGenerationFailed] = useState(false);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'fallback'>('idle');
  const [sourceCount, setSourceCount] = useState(0);
  const [planRevisionNote, setPlanRevisionNote] = useState('');
  const [planRevising, setPlanRevising] = useState(false);
  /** Raw model output while generating outline (streaming when provider supports it). */
  const [planStreamText, setPlanStreamText] = useState('');
  /** Raw model output while generating report (stream preview; parsed after complete). */
  const [reportStreamText, setReportStreamText] = useState('');
  const [searchSources, setSearchSources] = useState<ResearchSessionWebpageSnapshot[]>([]);
  const [sourceDetail, setSourceDetail] = useState<ResearchSessionWebpageSnapshot | null>(null);
  const executeResearchInFlightRef = useRef(false);
  /** When Metaso key is set: classifier result for current session (whether to call web search). */
  const labNeedWebRef = useRef(true);

  const pastSessions = useLiveQuery(
    () => db.researchSessions.orderBy('createdAt').reverse().limit(RESEARCH_HISTORY_LIMIT).toArray(),
    []
  ) ?? [];

  useEffect(() => {
    if (!sourceDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSourceDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sourceDetail]);

  const openHistorySession = (session: ResearchSession) => {
    setQuery(session.query);
    setResearchPlan(session.researchPlan.map((s) => ({ title: s.title, desc: s.desc })));
    setResearchReport({
      intro: session.researchReport.intro,
      points: session.researchReport.points ?? [],
      conclusion: session.researchReport.conclusion,
    });
    setSourceCount(session.sourceCount);
    setSearchStatus(session.searchStatus);
    setSearchSources(session.searchWebpages ?? []);
    setReportGenerationFailed(false);
    setPhase('completed');
  };

  const deleteResearchSession = async (sessionId: string) => {
    const ok = await confirm({
      message: t('lab.delete_session_confirm'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await db.researchSessions.delete(sessionId);
    } catch (e) {
      console.error('[Scribe AI] ResearchLab delete session failed', formatAiError(e));
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
      console.warn('[Scribe AI] ResearchLab need_web classification failed', formatAiError(e));
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
   * Execute-phase search: reuse session classifier; skip the search call when model chose reasoning-only.
   */
  const resolveWebSearchForExecute = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.searchApiKey?.trim();
    if (!apiKey) {
      return tryWebSearch(searchQuery);
    }
    if (!labNeedWebRef.current) {
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
      console.warn('[Scribe AI] Metaso search failed, degrading to offline mode', formatAiError(e));
      setSearchStatus('fallback');
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'fallback', webpages: [] };
    }
  };

  const generatePlan = async () => {
    setPhase('planning');
    setReportGenerationFailed(false);
    setSearchStatus('idle');
    setSearchSources([]);
    setSourceDetail(null);
    setPlanRevisionNote('');
    labNeedWebRef.current = true;
    setPlanStreamText('');
    setReportStreamText('');

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
      setPhase('plan_ready');
    } catch (e) {
      console.error('[Scribe AI] ResearchLab generatePlan failed', formatAiError(e));
      setPlanStreamText('');
      setResearchPlan(researchPlanFallback(t));
      setPhase('plan_ready');
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
      console.error('[Scribe AI] ResearchLab revisePlan failed', formatAiError(e));
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

  const executeResearch = async () => {
    if (executeResearchInFlightRef.current) return;
    executeResearchInFlightRef.current = true;
    try {
      setPhase('researching');
      setReportGenerationFailed(false);
      setSourceDetail(null);
      setResearchExecStage('resolving_context');

      const {
        context: searchContext,
        sourceCount: persistedSourceCount,
        searchStatus: persistedSearchStatus,
        webpages: persistedSearchWebpages,
      } = await resolveWebSearchForExecute(query);

      setResearchExecStage('generating_report');
      setReportStreamText('');

      const planContext =
        researchPlan.length > 0
          ? `\n\nThe user-approved research plan (your report must follow this structure: align the "points" array with these steps in order and honor each step's goals in the analysis):\n${JSON.stringify(researchPlan, null, 2)}`
          : '';

      const fallbackReport = researchReportParseFallback(t);

      let finalReport: ResearchReportBody = fallbackReport;
      let executionSucceeded = false;

      try {
        const prompt = searchContext
          ? `${t('lab.ai_research_report', { query })}${planContext}\n\nUse the following web search results as primary sources for your report. Cite sources where appropriate.\n\n${searchContext}`
          : `${t('lab.ai_research_report', { query })}${planContext}`;

        const text = await callAI({
          config: aiConfig,
          systemInstruction: getLocaleDirective(),
          prompt,
          onStreamChunk: (acc) => setReportStreamText(acc),
        });
        setReportStreamText('');
        const report = normalizeResearchReport(parseLenientLlmJson(text ?? '{}'));
        setResearchReport(report);
        finalReport = report;
        executionSucceeded = true;
      } catch (e) {
        console.error('[Scribe AI] ResearchLab executeResearch failed', formatAiError(e));
        setReportStreamText('');
        setReportGenerationFailed(true);
        setResearchReport(fallbackReport);
        finalReport = fallbackReport;
      } finally {
        if (executionSucceeded) {
          try {
            const now = Date.now();
            await db.researchSessions.add({
              id: crypto.randomUUID(),
              query,
              createdAt: now,
              updatedAt: now,
              researchPlan: researchPlan.map((s) => ({ title: s.title, desc: s.desc })),
              researchReport: {
                intro: finalReport.intro ?? '',
                points: Array.isArray(finalReport.points)
                  ? finalReport.points.map((p: { title?: string; text?: string }) => ({
                      title: String(p?.title ?? ''),
                      text: String(p?.text ?? ''),
                    }))
                  : [],
                conclusion: finalReport.conclusion ?? '',
              },
              sourceCount: persistedSourceCount,
              searchStatus: persistedSearchStatus,
              searchWebpages: persistedSearchWebpages,
            });
          } catch (persistErr) {
            console.error('[Scribe AI] ResearchLab failed to persist session', persistErr);
          }
        }
        setPhase('completed');
      }
    } finally {
      executeResearchInFlightRef.current = false;
    }
  };

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
                     onClick={() => {
                       setPhase('idle');
                       setQuery('');
                       setSearchStatus('idle');
                       setSourceCount(0);
                       setSearchSources([]);
                       setReportGenerationFailed(false);
                       setSourceDetail(null);
                       labNeedWebRef.current = true;
                       setPlanStreamText('');
                     }}
                     className="text-app-accent text-xs hover:underline font-bold"
                   >
                     {t('lab.new_research')}
                   </button>
                 )}
               </div>

               {/* Search status indicator */}
               {searchStatus === 'searching' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-app-accent/30 rounded text-xs flex items-center gap-2 text-app-accent font-mono">
                   <Globe className="w-3 h-3 animate-pulse" />
                   <span>{t('lab.searching')}</span>
                 </div>
               )}
               {searchStatus === 'found' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-[#4ade80]/30 rounded text-xs flex items-center gap-2 text-[#16a34a] font-mono">
                   <Globe className="w-3 h-3" />
                   <span>{t('lab.search_complete', { count: sourceCount })}</span>
                 </div>
               )}
               {searchStatus === 'fallback' && (
                 <div className="mb-3 p-2 bg-app-surface-raised border border-[#eab308]/30 rounded text-xs flex items-center gap-2 text-[#a16207] font-mono">
                   <AlertTriangle className="w-3 h-3" />
                   <span>{t('lab.search_fallback')}</span>
                 </div>
               )}

               <div className="space-y-3">
                 {searchSources.length > 0 ? (
                   searchSources.map((wp, idx) => {
                     const cardShell =
                       'w-full text-left bg-app-surface-raised border border-app-border p-3 rounded-lg text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/30 hover:border-app-accent/45 hover:shadow-md cursor-pointer';
                     return (
                       <button
                         key={`${wp.link}-${idx}`}
                         type="button"
                         data-testid={`lab-source-card-${idx}`}
                         aria-label={t('lab.source_view_detail')}
                         onClick={() => setSourceDetail(wp)}
                         className={`${cardShell} ${
                           phase === 'researching' && researchExecStage === 'resolving_context'
                             ? 'opacity-90'
                             : ''
                         }`}
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
                 <h2 className="text-3xl font-serif font-bold text-app-text">{query}</h2>
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
                           <div className="text-center text-app-text-muted">Generating plan...</div>
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

                     <div className="flex justify-end pt-6 border-t border-app-border mt-6">
                        <button
                          type="button"
                          onClick={() => void executeResearch()}
                          disabled={planRevising || researchPlan.length === 0}
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
           <div className="flex-1 flex items-center justify-center p-8 w-full max-w-2xl mx-auto">
              <div className="w-full bg-app-surface-raised border border-app-border shadow-md rounded-xl p-6 font-mono text-sm">
                 <div className="flex items-center gap-2 mb-6 text-app-accent font-bold">
                   <Terminal className="w-4 h-4" />
                   <span>{t('lab.executing')}</span>
                 </div>

                 <div className="space-y-4 text-app-text-faint">
                   {/* Web search step */}
                   <div className="flex items-center gap-3">
                     {searchStatus === 'found' ? (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                     ) : searchStatus === 'fallback' ? (
                       <AlertTriangle className="w-4 h-4 text-[#eab308]" />
                     ) : searchStatus === 'searching' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-app-accent" />
                     ) : (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                     )}
                     <span className={
                       searchStatus === 'found' ? "text-app-text" :
                       searchStatus === 'fallback' ? "text-[#a16207]" :
                       searchStatus === 'searching' ? "text-app-text" :
                       "text-app-text-muted"
                     }>
                       {searchStatus === 'searching' && t('lab.searching')}
                       {searchStatus === 'found' && t('lab.search_complete', { count: sourceCount })}
                       {searchStatus === 'fallback' && t('lab.search_fallback')}
                       {searchStatus === 'idle' &&
                         (aiConfig.searchApiKey ? t('lab.search_preparing') : t('lab.search_offline_no_key'))}
                     </span>
                   </div>

                   <div className="flex items-center gap-3">
                     {researchExecStage === 'resolving_context' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-app-accent shrink-0" aria-hidden />
                     ) : (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" aria-hidden />
                     )}
                     <span
                       className={
                         researchExecStage === 'resolving_context' ? 'text-app-text-muted' : 'text-app-text'
                       }
                     >
                       {t('lab.stage_resolving_context')}
                     </span>
                   </div>

                   <div className="flex items-center gap-3">
                     {researchExecStage === 'generating_report' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-app-accent shrink-0" aria-hidden />
                     ) : (
                       <span
                         className="w-4 h-4 shrink-0 rounded-full border-2 border-app-border"
                         aria-hidden
                       />
                     )}
                     <span
                       className={
                         researchExecStage === 'generating_report'
                           ? 'text-app-text'
                           : 'text-app-text-faint'
                       }
                     >
                       {reportStreamText
                         ? t('lab.report_stream_status')
                         : t('lab.stage_generating_report')}
                     </span>
                   </div>
                   {reportStreamText ? (
                     <pre className="mt-4 max-h-[min(360px,50vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-app-text bg-app-surface border border-app-border rounded-lg p-4">
                       {reportStreamText}
                     </pre>
                   ) : null}
                 </div>
              </div>
           </div>
         )}

         {phase === 'completed' && (
            <div className="flex-1 flex overflow-hidden">
               {/* Final Report */}
               <div className="flex-1 bg-app-surface text-app-text overflow-y-auto relative paper-texture">
                     <div className="max-w-5xl mx-auto px-16 py-14">
                     {reportGenerationFailed && (
                       <div className="mb-8 rounded-xl border border-[#eab308]/40 bg-[#fffbeb] px-5 py-4 font-sans text-sm text-[#713f12] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                         <div className="flex gap-3 min-w-0">
                           <AlertTriangle className="w-5 h-5 shrink-0 text-[#b45309]" aria-hidden />
                           <p className="leading-relaxed">{t('lab.report_failed_banner')}</p>
                         </div>
                         <button
                           type="button"
                           data-testid="lab-retry-report"
                           onClick={() => void executeResearch()}
                           className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-app-accent px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-app-accent-hover transition-colors"
                         >
                           {t('lab.retry_generate_report')}
                         </button>
                       </div>
                     )}
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
                      console.error('[Scribe AI] openExternalUrl failed', err),
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
