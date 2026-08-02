import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWebSearch = vi.fn();
vi.mock('../../src/services/search', () => ({
  webSearch: (...args: unknown[]) => mockWebSearch(...args),
  buildSearchContext: (results: { webpages?: { title: string; snippet: string }[] }) => {
    const pages = results?.webpages ?? [];
    if (pages.length === 0) return '';
    return pages.map((w) => `[Source] ${w.title}: ${w.snippet}`).join('\n');
  },
}));

vi.mock('../../src/utils/aiI18n', () => ({
  getLocaleDirective: () => 'Reply in English.',
}));

import {
  MAX_RESEARCH_PLAN_STEPS,
  buildInitialRunSteps,
  estimateResearchRunCalls,
  parseNeedWebDecision,
  researchRunReducer,
  RESEARCH_RUN_IDLE,
  runSteppedResearch,
  type ResearchRunEvent,
} from '../../src/hooks/useResearchRun';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 把 i18n key + 参数拍平成可断言的字符串（等价于真实模板会包含这些值）。 */
const translate = (key: string, opts?: Record<string, unknown>) =>
  opts
    ? `${key}::${Object.entries(opts)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('&')}`
    : key;

const baseConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  baseUrl: '',
  model: 'gpt-4o',
};

const searchConfig = {
  ...baseConfig,
  searchProvider: 'metaso' as const,
  searchApiKey: 'sk-metaso',
};

const plan3 = [
  { title: 'Alpha', desc: 'da' },
  { title: 'Beta', desc: 'db' },
  { title: 'Gamma', desc: 'dc' },
];

const reportJson = JSON.stringify({
  intro: 'Final intro',
  points: [
    { title: 'P1', text: 'T1' },
    { title: 'P2', text: 'T2' },
    { title: 'P3', text: 'T3' },
  ],
  conclusion: 'Final conclusion',
});

type CallOpts = {
  prompt: string;
  onStreamChunk?: (acc: string) => void;
};

/** 按 prompt 前缀路由的 callAI mock：subquery → `subq-N`，analysis → `analysis-N`，汇总 → 报告 JSON。 */
function makeRouterCallAI(overrides?: {
  synthesis?: string;
  onAnalysis?: (index: number, opts: CallOpts) => void;
}) {
  let subq = 0;
  let analysis = 0;
  return vi.fn().mockImplementation(async (opts: CallOpts) => {
    const { prompt } = opts;
    if (prompt.startsWith('lab.ai_need_web_classifier')) return '{"need_web":true}';
    if (prompt.startsWith('lab.ai_step_subquery')) {
      subq += 1;
      return `subq-${subq}`;
    }
    if (prompt.startsWith('lab.ai_step_analysis')) {
      analysis += 1;
      overrides?.onAnalysis?.(analysis, opts);
      return `analysis-${analysis}`;
    }
    if (prompt.startsWith('lab.ai_synthesize_report')) {
      return overrides?.synthesis ?? reportJson;
    }
    throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
  });
}

function webpage(n: number, link?: string) {
  return {
    title: `Page ${n}`,
    link: link ?? `https://example.com/${n}`,
    snippet: `Snippet ${n}`,
    score: '',
    date: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWebSearch.mockResolvedValue({ credits: 0, total: 1, webpages: [webpage(1)] });
});

// ---------------------------------------------------------------------------
// runSteppedResearch
// ---------------------------------------------------------------------------

describe('runSteppedResearch', () => {
  it('每步一次检索 + 一次分析，汇总在最后，报告结构不变', async () => {
    mockWebSearch
      .mockResolvedValueOnce({ credits: 0, total: 1, webpages: [webpage(1)] })
      .mockResolvedValueOnce({ credits: 0, total: 1, webpages: [webpage(2)] })
      .mockResolvedValueOnce({ credits: 0, total: 1, webpages: [webpage(3)] });
    const callAI = makeRouterCallAI();
    const events: ResearchRunEvent[] = [];

    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: searchConfig,
      callAI,
      translate,
      needWeb: true,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    // 3 步 × (子查询 + 分析) + 1 汇总 = 7 次模型调用；每步恰好一次检索
    expect(callAI).toHaveBeenCalledTimes(7);
    expect(mockWebSearch).toHaveBeenCalledTimes(3);
    expect(mockWebSearch.mock.calls.map((c) => c[0])).toEqual(['subq-1', 'subq-2', 'subq-3']);
    expect(mockWebSearch.mock.calls[0][1]).toEqual({ kind: 'metaso', apiKey: 'sk-metaso' });

    // 汇总一定是最后一次模型调用，且吃到了每一步的分析
    const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
    const synthPrompt = prompts[prompts.length - 1];
    expect(synthPrompt.startsWith('lab.ai_synthesize_report')).toBe(true);
    expect(synthPrompt).toContain('analysis-1');
    expect(synthPrompt).toContain('analysis-2');
    expect(synthPrompt).toContain('analysis-3');
    expect(synthPrompt).toContain('total=3');

    // 分析 prompt 里带该步的检索结果
    const analysisPrompts = prompts.filter((p) => p.startsWith('lab.ai_step_analysis'));
    expect(analysisPrompts[0]).toContain('Page 1');
    expect(analysisPrompts[1]).toContain('Page 2');

    // 报告结构保持 intro/points/conclusion，points 与步骤一一对应
    expect(result.status).toBe('completed');
    expect(result.report).toEqual({
      intro: 'Final intro',
      points: [
        { title: 'P1', text: 'T1' },
        { title: 'P2', text: 'T2' },
        { title: 'P3', text: 'T3' },
      ],
      conclusion: 'Final conclusion',
    });
    expect(result.searchStatus).toBe('found');
    expect(result.sourceCount).toBe(3);
    expect(result.webpages.map((w) => w.title)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(result.callsDone).toBe(7);

    // 事件顺序：synthesis_start 在所有步骤完成之后
    const synthIdx = events.findIndex((e) => e.type === 'synthesis_start');
    const lastStepDone = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'step_status' && e.status === 'done')
      .map(({ i }) => i)
      .pop();
    expect(synthIdx).toBeGreaterThan(lastStepDone ?? Infinity * -1);
  });

  it('步骤接力：后一步的 prompt 带上之前步骤的结论摘要', async () => {
    const callAI = makeRouterCallAI();
    await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: searchConfig,
      callAI,
      translate,
      needWeb: true,
      signal: new AbortController().signal,
    });

    const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
    const analysisPrompts = prompts.filter((p) => p.startsWith('lab.ai_step_analysis'));
    // 第一步没有前置结论
    expect(analysisPrompts[0]).toContain('lab.ai_prior_none');
    expect(analysisPrompts[0]).not.toContain('analysis-1');
    // 第二步吃到第一步结论、第三步吃到前两步结论
    expect(analysisPrompts[1]).toContain('analysis-1');
    expect(analysisPrompts[2]).toContain('analysis-1');
    expect(analysisPrompts[2]).toContain('analysis-2');
    // 子查询改写 prompt 同样接力
    const subqPrompts = prompts.filter((p) => p.startsWith('lab.ai_step_subquery'));
    expect(subqPrompts[1]).toContain('analysis-1');
  });

  it('中断后停止后续调用，已完成步骤的产出保留', async () => {
    const controller = new AbortController();
    let subq = 0;
    const callAI = vi.fn().mockImplementation(async ({ prompt }: CallOpts) => {
      if (prompt.startsWith('lab.ai_step_subquery')) {
        subq += 1;
        if (subq === 2) controller.abort();
        return `subq-${subq}`;
      }
      if (prompt.startsWith('lab.ai_step_analysis')) return 'analysis-1';
      if (prompt.startsWith('lab.ai_synthesize_report')) return reportJson;
      return '';
    });

    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: searchConfig,
      callAI,
      translate,
      needWeb: true,
      signal: controller.signal,
    });

    expect(result.status).toBe('aborted');
    // 子查询1 + 分析1 + 子查询2（中断发生在这次调用内）之后不再有任何调用
    expect(callAI).toHaveBeenCalledTimes(3);
    expect(mockWebSearch).toHaveBeenCalledTimes(1);
    const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
    expect(prompts.some((p) => p.startsWith('lab.ai_synthesize_report'))).toBe(false);
    // 第一步的产出保留
    expect(result.steps[0].status).toBe('done');
    expect(result.steps[0].analysis).toBe('analysis-1');
    expect(result.steps[0].sources.length).toBe(1);
    expect(result.report).toBeNull();
  });

  it('无搜索 Key：不改写子查询、不检索，每步只有一次分析', async () => {
    const callAI = makeRouterCallAI();
    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3.slice(0, 2),
      aiConfig: baseConfig,
      callAI,
      translate,
      needWeb: null,
      signal: new AbortController().signal,
    });

    // 2 分析 + 1 汇总
    expect(callAI).toHaveBeenCalledTimes(3);
    expect(mockWebSearch).not.toHaveBeenCalled();
    const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
    expect(prompts.some((p) => p.startsWith('lab.ai_step_subquery'))).toBe(false);
    expect(prompts.some((p) => p.startsWith('lab.ai_need_web_classifier'))).toBe(false);
    expect(prompts[0]).toContain('lab.ai_sources_none');
    expect(result.status).toBe('completed');
    expect(result.searchStatus).toBe('idle');
  });

  it('历史续跑（needWeb=null）时补跑一次分类器；判 false 则全程不检索', async () => {
    const callAI = vi.fn().mockImplementation(async ({ prompt }: CallOpts) => {
      if (prompt.startsWith('lab.ai_need_web_classifier')) return '{"need_web":false}';
      if (prompt.startsWith('lab.ai_step_analysis')) return 'analysis';
      if (prompt.startsWith('lab.ai_synthesize_report')) return reportJson;
      throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
    });

    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: searchConfig,
      callAI,
      translate,
      needWeb: null,
      signal: new AbortController().signal,
    });

    // 分类器 + 3 分析 + 1 汇总；没有子查询改写、没有检索
    expect(callAI).toHaveBeenCalledTimes(5);
    expect(mockWebSearch).not.toHaveBeenCalled();
    expect(result.needWebResolved).toBe(false);
    expect(result.status).toBe('completed');
  });

  it('某步分析调用失败：终止运行并标记失败步骤，之前步骤保留', async () => {
    let analysis = 0;
    const callAI = vi.fn().mockImplementation(async ({ prompt }: CallOpts) => {
      if (prompt.startsWith('lab.ai_step_subquery')) return 'subq';
      if (prompt.startsWith('lab.ai_step_analysis')) {
        analysis += 1;
        if (analysis === 2) throw new Error('boom');
        return `analysis-${analysis}`;
      }
      if (prompt.startsWith('lab.ai_synthesize_report')) return reportJson;
      return '';
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runSteppedResearch({
        query: 'Q',
        plan: plan3,
        aiConfig: searchConfig,
        callAI,
        translate,
        needWeb: true,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe(1);
      expect(result.steps[0].status).toBe('done');
      expect(result.steps[1].status).toBe('failed');
      expect(result.steps[2].status).toBe('pending');
      expect(result.report).toBeNull();
      // 第 2 步失败后不再有第 3 步和汇总的调用
      const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
      expect(prompts.some((p) => p.startsWith('lab.ai_synthesize_report'))).toBe(false);
      expect(callAI).toHaveBeenCalledTimes(4); // subq1 analysis1 subq2 analysis2(失败)
    } finally {
      errSpy.mockRestore();
    }
  });

  it('汇总返回非法 JSON：failed 且 report 为空，各步产出保留', async () => {
    const callAI = makeRouterCallAI({ synthesis: 'NOT JSON {{' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runSteppedResearch({
        query: 'Q',
        plan: plan3,
        aiConfig: baseConfig,
        callAI,
        translate,
        needWeb: null,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('failed');
      expect(result.failedStep).toBeNull();
      expect(result.report).toBeNull();
      expect(result.steps.map((s) => s.analysis)).toEqual(['analysis-1', 'analysis-2', 'analysis-3']);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('汇总 JSON 合法但 points 为空时，退回按步骤产出补齐 points', async () => {
    const callAI = makeRouterCallAI({
      synthesis: JSON.stringify({ intro: 'I', points: [], conclusion: 'C' }),
    });
    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: baseConfig,
      callAI,
      translate,
      needWeb: null,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('completed');
    expect(result.report?.points).toEqual([
      { title: 'Alpha', text: 'analysis-1' },
      { title: 'Beta', text: 'analysis-2' },
      { title: 'Gamma', text: 'analysis-3' },
    ]);
  });

  it('计划超过 5 步时截断到上限', async () => {
    const bigPlan = Array.from({ length: 7 }, (_, i) => ({ title: `S${i + 1}`, desc: '' }));
    const callAI = makeRouterCallAI();
    const result = await runSteppedResearch({
      query: 'Q',
      plan: bigPlan,
      aiConfig: baseConfig,
      callAI,
      translate,
      needWeb: null,
      signal: new AbortController().signal,
    });
    expect(result.steps.length).toBe(MAX_RESEARCH_PLAN_STEPS);
    // 5 分析 + 1 汇总
    expect(callAI).toHaveBeenCalledTimes(6);
  });

  it('各步来源按 link 合并去重', async () => {
    mockWebSearch
      .mockResolvedValueOnce({ credits: 0, total: 2, webpages: [webpage(1), webpage(2)] })
      .mockResolvedValueOnce({ credits: 0, total: 2, webpages: [webpage(1), webpage(3)] })
      .mockResolvedValueOnce({ credits: 0, total: 1, webpages: [webpage(2)] });
    const callAI = makeRouterCallAI();
    const result = await runSteppedResearch({
      query: 'Q',
      plan: plan3,
      aiConfig: searchConfig,
      callAI,
      translate,
      needWeb: true,
      signal: new AbortController().signal,
    });
    expect(result.sourceCount).toBe(3);
    expect(result.webpages.map((w) => w.link).sort()).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
  });

  it('检索失败降级：该步标记 searchFailed，分析照常进行', async () => {
    mockWebSearch.mockRejectedValue(new Error('network'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const callAI = makeRouterCallAI();
      const result = await runSteppedResearch({
        query: 'Q',
        plan: plan3.slice(0, 1),
        aiConfig: searchConfig,
        callAI,
        translate,
        needWeb: true,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('completed');
      expect(result.steps[0].searchFailed).toBe(true);
      expect(result.searchStatus).toBe('fallback');
      const prompts = callAI.mock.calls.map((c) => (c[0] as CallOpts).prompt);
      const analysisPrompt = prompts.find((p) => p.startsWith('lab.ai_step_analysis'));
      expect(analysisPrompt).toContain('lab.ai_sources_none');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('分析流式输出通过 step_analysis 事件透出', async () => {
    const events: ResearchRunEvent[] = [];
    const callAI = makeRouterCallAI({
      onAnalysis: (_index, opts) => {
        opts.onStreamChunk?.('partial text');
      },
    });
    await runSteppedResearch({
      query: 'Q',
      plan: plan3.slice(0, 1),
      aiConfig: baseConfig,
      callAI,
      translate,
      needWeb: null,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    const analysisEvents = events.filter((e) => e.type === 'step_analysis');
    expect(analysisEvents.some((e) => e.type === 'step_analysis' && e.analysis === 'partial text')).toBe(true);
    expect(analysisEvents[analysisEvents.length - 1]).toMatchObject({ analysis: 'analysis-1' });
  });
});

// ---------------------------------------------------------------------------
// estimate / reducer / misc
// ---------------------------------------------------------------------------

describe('estimateResearchRunCalls', () => {
  it('带检索：步数×2 + 1 汇总；检索次数 = 步数', () => {
    expect(estimateResearchRunCalls(3, true)).toEqual({ llmCalls: 7, searchCalls: 3 });
  });
  it('不检索：步数 + 1 汇总', () => {
    expect(estimateResearchRunCalls(3, false)).toEqual({ llmCalls: 4, searchCalls: 0 });
  });
  it('需要补跑分类器时 +1', () => {
    expect(estimateResearchRunCalls(3, true, true)).toEqual({ llmCalls: 8, searchCalls: 3 });
  });
  it('步数按上限 5 截断', () => {
    expect(estimateResearchRunCalls(9, true)).toEqual({ llmCalls: 11, searchCalls: 5 });
  });
});

describe('researchRunReducer', () => {
  it('run_start → 事件流 → run_finish 折叠成 UI 状态', () => {
    const steps = buildInitialRunSteps(plan3);
    let state = researchRunReducer(RESEARCH_RUN_IDLE, {
      type: 'run_start',
      steps,
      estimatedLlmCalls: 7,
      estimatedSearchCalls: 3,
    });
    expect(state.running).toBe(true);
    expect(state.stage).toBe('steps');

    state = researchRunReducer(state, { type: 'step_status', index: 0, status: 'analyzing' });
    expect(state.currentStep).toBe(0);
    expect(state.steps[0].status).toBe('analyzing');

    state = researchRunReducer(state, { type: 'call_done' });
    state = researchRunReducer(state, { type: 'step_analysis', index: 0, analysis: 'hello' });
    expect(state.callsDone).toBe(1);
    expect(state.steps[0].analysis).toBe('hello');

    state = researchRunReducer(state, { type: 'synthesis_start' });
    expect(state.stage).toBe('synthesizing');
    state = researchRunReducer(state, { type: 'report_stream', text: '{"intro"' });
    expect(state.reportStreamText).toBe('{"intro"');

    state = researchRunReducer(state, { type: 'run_finish', outcome: 'completed', failedStep: null });
    expect(state.running).toBe(false);
    expect(state.stage).toBe('finished');
    expect(state.outcome).toBe('completed');

    state = researchRunReducer(state, { type: 'run_reset' });
    expect(state).toEqual(RESEARCH_RUN_IDLE);
  });
});

describe('parseNeedWebDecision', () => {
  it('解析布尔并在含糊时默认 true', () => {
    expect(parseNeedWebDecision('{"need_web": false}')).toBe(false);
    expect(parseNeedWebDecision('{"need_web": true}')).toBe(true);
    expect(parseNeedWebDecision('garbage')).toBe(true);
  });
});
