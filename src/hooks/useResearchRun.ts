import { useCallback, useReducer, useRef } from 'react';
import type { CallAIFn } from '../types/ai';
import type { SearchProviderKind } from '../types/aiConfig';
import type {
  ResearchSessionSearchStatus,
  ResearchSessionWebpageSnapshot,
} from '../db';
import { webSearch, buildSearchContext } from '../services/search';
import { DEFAULT_SEARCH_PROVIDER } from '../constants/searchProviders';
import { formatAiError } from '../services/ai';
import { getLocaleDirective } from '../utils/aiI18n';
import { parseLenientLlmJson } from '../utils/llmJson';
import { logger } from '../utils/logger';

/**
 * Research Lab「真分步执行」编排（roadmap B5）。
 *
 * 一次运行 = 对计划的每一步依次做「改写子查询 → 联网检索 → 分步分析」，
 * 步骤之间通过「此前结论摘要」接力，最后再用一次调用把各步产出汇总成
 * `{intro, points, conclusion}` 结构的报告（points 与步骤一一对应，
 * `buildResearchFrame` 等下游不用改）。
 *
 * 编排核心 `runSteppedResearch` 是纯 async 函数（不碰 React / IndexedDB），
 * 通过事件回调向外汇报进度；`useResearchRun` 用 reducer 把事件流折叠成
 * UI 可渲染的状态，并负责 AbortController 的生命周期。
 */

/** 计划步骤上限：生成计划的 prompt 约束 3–5 步，这里是代码侧的硬保险。 */
export const MAX_RESEARCH_PLAN_STEPS = 5;

export type ResearchRunPlanStep = { title: string; desc: string };

export type ResearchRunStepStatus =
  | 'pending'
  | 'querying'
  | 'searching'
  | 'analyzing'
  | 'done'
  | 'failed';

export interface ResearchRunStep {
  title: string;
  desc: string;
  status: ResearchRunStepStatus;
  /** 该步骤经轻量改写后的检索子查询（不检索时为空）。 */
  subQuery: string;
  /** 该步骤的分析段落（流式期间是中间累计文本）。 */
  analysis: string;
  /** 该步骤检索到的来源快照。 */
  sources: ResearchSessionWebpageSnapshot[];
  /** 该步骤发起过检索但失败或没有结果。 */
  searchFailed: boolean;
}

export interface ResearchRunReport {
  intro: string;
  points: { title: string; text: string }[];
  conclusion: string;
}

export interface ResearchRunAiConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  searchProvider?: SearchProviderKind;
  searchApiKey?: string;
}

export type ResearchRunTranslate = (key: string, opts?: Record<string, unknown>) => string;

export interface ResearchRunResult {
  status: 'completed' | 'aborted' | 'failed';
  /** 仅 completed 时非空。 */
  report: ResearchRunReport | null;
  /** status 为 failed 且失败发生在某步分析时，为该步下标（0 起）；汇总失败为 null。 */
  failedStep: number | null;
  steps: ResearchRunStep[];
  /** 各步来源按 link 合并去重后的快照（写入 ResearchSession.searchWebpages）。 */
  webpages: ResearchSessionWebpageSnapshot[];
  sourceCount: number;
  searchStatus: ResearchSessionSearchStatus;
  /** 已发生的模型/检索调用总数。 */
  callsDone: number;
  /** 本次运行内解出的分类器结论（供调用方缓存；没跑过分类器时保持传入值）。 */
  needWebResolved: boolean | null;
}

// ---------------------------------------------------------------------------
// Events & reducer
// ---------------------------------------------------------------------------

export type ResearchRunEvent =
  | { type: 'call_done' }
  | { type: 'step_status'; index: number; status: ResearchRunStepStatus }
  | { type: 'step_subquery'; index: number; subQuery: string }
  | {
      type: 'step_sources';
      index: number;
      sources: ResearchSessionWebpageSnapshot[];
      searchFailed: boolean;
    }
  | { type: 'step_analysis'; index: number; analysis: string }
  | { type: 'synthesis_start' }
  | { type: 'report_stream'; text: string };

export type ResearchRunStage = 'idle' | 'steps' | 'synthesizing' | 'finished';
export type ResearchRunOutcome = 'none' | 'completed' | 'aborted' | 'failed';

export interface ResearchRunState {
  running: boolean;
  stage: ResearchRunStage;
  steps: ResearchRunStep[];
  /** 当前执行到的步骤下标（-1 表示还没进入任何步骤）。 */
  currentStep: number;
  callsDone: number;
  estimatedLlmCalls: number;
  estimatedSearchCalls: number;
  reportStreamText: string;
  outcome: ResearchRunOutcome;
  failedStep: number | null;
}

export const RESEARCH_RUN_IDLE: ResearchRunState = {
  running: false,
  stage: 'idle',
  steps: [],
  currentStep: -1,
  callsDone: 0,
  estimatedLlmCalls: 0,
  estimatedSearchCalls: 0,
  reportStreamText: '',
  outcome: 'none',
  failedStep: null,
};

type ResearchRunAction =
  | ResearchRunEvent
  | {
      type: 'run_start';
      steps: ResearchRunStep[];
      estimatedLlmCalls: number;
      estimatedSearchCalls: number;
    }
  | {
      type: 'run_finish';
      outcome: Exclude<ResearchRunOutcome, 'none'>;
      failedStep: number | null;
    }
  | { type: 'run_reset' };

function patchStep(
  steps: ResearchRunStep[],
  index: number,
  patch: Partial<ResearchRunStep>,
): ResearchRunStep[] {
  if (!steps[index]) return steps;
  const next = [...steps];
  next[index] = { ...next[index], ...patch };
  return next;
}

export function researchRunReducer(
  state: ResearchRunState,
  action: ResearchRunAction,
): ResearchRunState {
  switch (action.type) {
    case 'run_start':
      return {
        ...RESEARCH_RUN_IDLE,
        running: true,
        stage: 'steps',
        steps: action.steps,
        estimatedLlmCalls: action.estimatedLlmCalls,
        estimatedSearchCalls: action.estimatedSearchCalls,
      };
    case 'call_done':
      return { ...state, callsDone: state.callsDone + 1 };
    case 'step_status':
      return {
        ...state,
        currentStep: action.index,
        steps: patchStep(state.steps, action.index, { status: action.status }),
      };
    case 'step_subquery':
      return { ...state, steps: patchStep(state.steps, action.index, { subQuery: action.subQuery }) };
    case 'step_sources':
      return {
        ...state,
        steps: patchStep(state.steps, action.index, {
          sources: action.sources,
          searchFailed: action.searchFailed,
        }),
      };
    case 'step_analysis':
      return { ...state, steps: patchStep(state.steps, action.index, { analysis: action.analysis }) };
    case 'synthesis_start':
      return { ...state, stage: 'synthesizing' };
    case 'report_stream':
      return { ...state, reportStreamText: action.text };
    case 'run_finish':
      return {
        ...state,
        running: false,
        stage: 'finished',
        outcome: action.outcome,
        failedStep: action.failedStep,
      };
    case 'run_reset':
      return RESEARCH_RUN_IDLE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse `{"need_web":boolean}` from classifier output; default true if ambiguous (prefer fetching sources). */
export function parseNeedWebDecision(text: string): boolean {
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

export function normalizeResearchReport(raw: unknown): ResearchRunReport {
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

/**
 * 执行成本预估：带检索时每步「改写 + 分析」两次模型调用，另加 1 次汇总；
 * 历史续跑还没跑过分类器时再加 1 次分类器调用。
 */
export function estimateResearchRunCalls(
  stepCount: number,
  withWebSearch: boolean,
  withClassifier = false,
): { llmCalls: number; searchCalls: number } {
  const steps = Math.max(0, Math.min(stepCount, MAX_RESEARCH_PLAN_STEPS));
  return {
    llmCalls: (withWebSearch ? steps * 2 : steps) + 1 + (withClassifier ? 1 : 0),
    searchCalls: withWebSearch ? steps : 0,
  };
}

export function buildInitialRunSteps(plan: ResearchRunPlanStep[]): ResearchRunStep[] {
  return plan.slice(0, MAX_RESEARCH_PLAN_STEPS).map((s) => ({
    title: s.title,
    desc: s.desc,
    status: 'pending' as const,
    subQuery: '',
    analysis: '',
    sources: [],
    searchFailed: false,
  }));
}

/** 子查询改写输出取第一行非空文本，剥掉引号与编号，防御模型话痨。 */
function extractSubQuery(text: string): string {
  const line =
    String(text ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? '';
  return line
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
    .trim()
    .slice(0, 200);
}

/** 接力摘要里的单步长度上限——防止后期步骤的 prompt 无限膨胀。 */
const STEP_SUMMARY_MAX_CHARS = 700;

function truncateForPrompt(s: string, max = STEP_SUMMARY_MAX_CHARS): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Orchestration core (pure async; unit-testable without React)
// ---------------------------------------------------------------------------

export interface RunSteppedResearchOptions {
  query: string;
  plan: ResearchRunPlanStep[];
  aiConfig: ResearchRunAiConfig;
  callAI: CallAIFn;
  translate: ResearchRunTranslate;
  /**
   * 分类器结论缓存：计划阶段已经跑过分类器时传布尔值；
   * null 表示还没跑过（历史续跑路径），有搜索 Key 时本函数会自己补跑一次。
   */
  needWeb: boolean | null;
  signal: AbortSignal;
  onEvent?: (event: ResearchRunEvent) => void;
}

export async function runSteppedResearch(
  opts: RunSteppedResearchOptions,
): Promise<ResearchRunResult> {
  const { query, aiConfig, callAI, translate, signal } = opts;
  const emit = (event: ResearchRunEvent) => {
    try {
      opts.onEvent?.(event);
    } catch {
      /* UI 回调异常不打断编排 */
    }
  };

  const steps = buildInitialRunSteps(opts.plan);
  const total = steps.length;
  let callsDone = 0;
  const bumpCall = () => {
    callsDone += 1;
    emit({ type: 'call_done' });
  };

  const merged = new Map<string, ResearchSessionWebpageSnapshot>();
  let anyFound = false;
  let anySearchAttempted = false;

  const searchApiKey = aiConfig.searchApiKey?.trim() ?? '';
  let needWeb = opts.needWeb;

  const buildResult = (
    status: ResearchRunResult['status'],
    report: ResearchRunReport | null = null,
    failedStep: number | null = null,
  ): ResearchRunResult => ({
    status,
    report,
    failedStep,
    steps,
    webpages: [...merged.values()],
    sourceCount: merged.size,
    searchStatus: anyFound ? 'found' : anySearchAttempted ? 'fallback' : 'idle',
    callsDone,
    needWebResolved: needWeb,
  });

  if (signal.aborted || total === 0) return buildResult('aborted');

  // ---- 分类器（仅在有 Key 且本会话还没跑过时补跑一次） ----------------------
  if (searchApiKey && needWeb === null) {
    try {
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: translate('lab.ai_need_web_classifier', { query }),
      });
      bumpCall();
      needWeb = parseNeedWebDecision(String(text ?? ''));
    } catch (e) {
      bumpCall();
      if (!signal.aborted) {
        logger.warn('research', 'need_web classification failed', formatAiError(e));
      }
      needWeb = true;
    }
    if (signal.aborted) return buildResult('aborted');
  }
  const doSearch = Boolean(searchApiKey) && needWeb !== false;

  /** 步骤间接力用的结论摘要（每步截断，防 prompt 膨胀）。 */
  const summaries: string[] = [];
  const priorBlock = () =>
    summaries.length > 0 ? summaries.join('\n\n') : translate('lab.ai_prior_none');

  for (let i = 0; i < total; i++) {
    const step = steps[i];
    if (signal.aborted) return buildResult('aborted');

    let searchContext = '';
    if (doSearch) {
      // (a) 轻量调用：把该步骤改写成一条检索子查询
      step.status = 'querying';
      emit({ type: 'step_status', index: i, status: 'querying' });
      let subQuery = step.title.trim() || query;
      try {
        const text = await callAI({
          config: aiConfig,
          systemInstruction: getLocaleDirective(),
          prompt: translate('lab.ai_step_subquery', {
            query,
            index: i + 1,
            total,
            title: step.title,
            desc: step.desc,
            prior: priorBlock(),
          }),
        });
        bumpCall();
        const extracted = extractSubQuery(String(text ?? ''));
        if (extracted) subQuery = extracted;
      } catch (e) {
        bumpCall();
        if (!signal.aborted) {
          logger.warn('research', 'sub-query rewrite failed', formatAiError(e));
        }
      }
      if (signal.aborted) return buildResult('aborted');
      step.subQuery = subQuery;
      emit({ type: 'step_subquery', index: i, subQuery });

      // (b) 每步一次检索
      step.status = 'searching';
      emit({ type: 'step_status', index: i, status: 'searching' });
      anySearchAttempted = true;
      try {
        const results = await webSearch(subQuery, {
          kind: aiConfig.searchProvider ?? DEFAULT_SEARCH_PROVIDER,
          apiKey: searchApiKey,
        });
        if (signal.aborted) return buildResult('aborted');
        searchContext = buildSearchContext(results);
        const webpages = (results.webpages ?? []).map((w) => ({
          title: String(w.title ?? ''),
          link: String(w.link ?? ''),
          snippet: String(w.snippet ?? ''),
        }));
        if (searchContext) {
          anyFound = true;
          step.sources = webpages;
          for (const wp of webpages) {
            if (wp.link && !merged.has(wp.link)) merged.set(wp.link, wp);
          }
          emit({ type: 'step_sources', index: i, sources: webpages, searchFailed: false });
        } else {
          step.searchFailed = true;
          emit({ type: 'step_sources', index: i, sources: [], searchFailed: true });
        }
      } catch (e) {
        if (signal.aborted) return buildResult('aborted');
        logger.warn('research', 'web search failed', formatAiError(e));
        step.searchFailed = true;
        emit({ type: 'step_sources', index: i, sources: [], searchFailed: true });
      }
    }

    if (signal.aborted) return buildResult('aborted');

    // (c) 该步骤的分析段落（带原始问题、步骤目标、本步来源、此前结论接力）
    step.status = 'analyzing';
    emit({ type: 'step_status', index: i, status: 'analyzing' });
    try {
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: translate('lab.ai_step_analysis', {
          query,
          index: i + 1,
          total,
          title: step.title,
          desc: step.desc,
          prior: priorBlock(),
          sources: searchContext || translate('lab.ai_sources_none'),
        }),
        onStreamChunk: (acc) => {
          if (signal.aborted) return;
          step.analysis = acc;
          emit({ type: 'step_analysis', index: i, analysis: acc });
        },
      });
      bumpCall();
      if (signal.aborted) return buildResult('aborted');
      step.analysis = String(text ?? '').trim();
      emit({ type: 'step_analysis', index: i, analysis: step.analysis });
    } catch (e) {
      bumpCall();
      if (signal.aborted) return buildResult('aborted');
      logger.error('research', 'step analysis failed', formatAiError(e));
      step.status = 'failed';
      emit({ type: 'step_status', index: i, status: 'failed' });
      return buildResult('failed', null, i);
    }
    step.status = 'done';
    emit({ type: 'step_status', index: i, status: 'done' });
    summaries.push(`[Step ${i + 1}: ${step.title}]\n${truncateForPrompt(step.analysis)}`);
  }

  // ---- 汇总：一次调用把各步产出折成最终报告（points 与步骤一一对应） --------
  if (signal.aborted) return buildResult('aborted');
  emit({ type: 'synthesis_start' });
  const findings = steps
    .map((s, i) => `### Step ${i + 1}: ${s.title}\n${s.analysis}`)
    .join('\n\n');

  let synthesisText: string | undefined;
  try {
    synthesisText = await callAI({
      config: aiConfig,
      systemInstruction: getLocaleDirective(),
      prompt: translate('lab.ai_synthesize_report', { query, total, findings }),
      onStreamChunk: (acc) => {
        if (!signal.aborted) emit({ type: 'report_stream', text: acc });
      },
    });
    bumpCall();
  } catch (e) {
    bumpCall();
    if (signal.aborted) return buildResult('aborted');
    logger.error('research', 'synthesis failed', formatAiError(e));
    return buildResult('failed', null, null);
  }
  if (signal.aborted) return buildResult('aborted');

  try {
    const report = normalizeResearchReport(parseLenientLlmJson(String(synthesisText ?? '{}')));
    if (report.points.length === 0) {
      // 模型没按结构给 points 时退回步骤产出本身，保证「points 与步骤一一对应」。
      report.points = steps.map((s) => ({ title: s.title, text: s.analysis }));
    }
    return buildResult('completed', report);
  } catch (e) {
    logger.error('research', 'report parse failed', formatAiError(e));
    return buildResult('failed', null, null);
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseResearchRunArgs {
  aiConfig: ResearchRunAiConfig;
  callAI: CallAIFn;
  translate: ResearchRunTranslate;
}

export interface UseResearchRunReturn {
  state: ResearchRunState;
  /** 启动一次分步研究；resolve 时给出最终结果（completed / aborted / failed）。 */
  start: (
    query: string,
    plan: ResearchRunPlanStep[],
    needWeb: boolean | null,
  ) => Promise<ResearchRunResult>;
  /** 中断当前运行：已完成步骤的产出保留在 state 里，后续调用不再发起。 */
  stop: () => void;
  reset: () => void;
}

export function useResearchRun({ aiConfig, callAI, translate }: UseResearchRunArgs): UseResearchRunReturn {
  const [state, dispatch] = useReducer(researchRunReducer, RESEARCH_RUN_IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (
      query: string,
      plan: ResearchRunPlanStep[],
      needWeb: boolean | null,
    ): Promise<ResearchRunResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const initialSteps = buildInitialRunSteps(plan);
      const searchKeySet = Boolean(aiConfig.searchApiKey?.trim());
      const willSearch = searchKeySet && needWeb !== false;
      const estimate = estimateResearchRunCalls(
        initialSteps.length,
        willSearch,
        searchKeySet && needWeb === null,
      );
      dispatch({
        type: 'run_start',
        steps: initialSteps,
        estimatedLlmCalls: estimate.llmCalls,
        estimatedSearchCalls: estimate.searchCalls,
      });

      const result = await runSteppedResearch({
        query,
        plan,
        aiConfig,
        callAI,
        translate,
        needWeb,
        signal: controller.signal,
        onEvent: dispatch,
      });
      dispatch({ type: 'run_finish', outcome: result.status, failedStep: result.failedStep });
      return result;
    },
    [aiConfig, callAI, translate],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'run_reset' });
  }, []);

  return { state, start, stop, reset };
}
