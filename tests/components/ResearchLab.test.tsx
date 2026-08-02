import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/utils/openExternal', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

import { ResearchLab } from '../../src/components/ResearchLab';
import { openExternalUrl } from '../../src/utils/openExternal';
import { db } from '../../src/db';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      const map: Record<string, string> = {
        'lab.investigate': 'What would you like to investigate?',
        'lab.idle_intro': 'Enter a broad topic or specific thesis. The agent will formulate a research plan, cross-reference archives, and generate a synthesized report.',
        'lab.placeholder': 'Search topic...',
        'lab.suggested_tag_1': '# spatial-encoding',
        'lab.suggested_tag_2': '# character-arcs',
        'lab.sources_utilized': 'Sources utilized',
        'lab.sources_none_hint': 'No sources yet.',
        'lab.source_view_detail': 'View source details',
        'lab.source_detail_heading': 'Web source',
        'lab.source_modal_hint': 'Hint',
        'lab.open_in_system_browser': 'Open in browser',
        'settings.close': 'Close',
        'lab.source_open_new_tab': 'Open source',
        'lab.source_untitled': 'Untitled',
        'lab.processed': 'Processed',
        'lab.target_inquiry': 'Target inquiry',
        'lab.recommended_plan_title': 'Recommended research plan',
        'lab.approve': 'Approve & Execute',
        'lab.executing': 'Agent Execution Log',
        'lab.report': 'Synthesized Report',
        'lab.new_research': 'New Research',
        'lab.past_sessions': 'Past Sessions',
        'lab.delete_session': 'Delete session',
        'lab.delete_session_confirm': 'Remove?',
        'lab.no_past_sessions': 'No completed research yet.',
        'lab.searching': 'Searching the web...',
        'lab.search_complete': '{{count}} web sources found',
        'lab.search_fallback': 'Search unavailable, using offline mode',
        'lab.plan_edit_hint': 'Edit plan hint',
        'lab.plan_revision_placeholder': 'Revision instructions...',
        'lab.plan_revision_apply': 'Update outline with AI',
        'lab.plan_revision_applying': 'Updating outline...',
        'lab.plan_stream_hint': 'Streaming hint',
        'lab.plan_stream_status': 'Receiving outline…',
        'lab.report_stream_status': 'Receiving report…',
        'lab.ai_need_web_classifier': 'Classifier {{query}}',
        'lab.ai_decompose_question': 'Decompose question: {{query}}',
        'lab.ai_revise_decompose': 'Revise decompose for {{query}}. Plan: {{plan}}. Instruction: {{instruction}}',
        'lab.ai_step_subquery': 'Subquery step {{index}}/{{total}} "{{title}}" for {{query}}. Prior: {{prior}}',
        'lab.ai_step_analysis': 'Analyze step {{index}}/{{total}} "{{title}}" for {{query}}. Prior: {{prior}}. Sources: {{sources}}',
        'lab.ai_synthesize_report': 'Synthesize {{query}} into {{total}} points from: {{findings}}',
        'lab.ai_prior_none': '(no prior findings)',
        'lab.ai_sources_none': '(no web sources)',
        'lab.search_preparing': 'Preparing web search…',
        'lab.search_offline_no_key': 'Offline mode — no Metaso API key configured.',
        'lab.report_footer_web': 'Based on {{count}} web sources + LLM synthesis',
        'lab.report_footer_offline': 'Offline mode — LLM-only synthesis',
        'lab.report_failed_banner': 'Report generation failed.',
        'lab.run_failed_banner': 'Step {{step}} failed.',
        'lab.run_stopped_banner': 'Research stopped.',
        'lab.retry_generate_report': 'Retry report generation',
        'lab.back_to_plan': 'Back to outline',
        'lab.stop_run': 'Stop',
        'lab.synthesizing': 'Synthesizing final report…',
        'lab.calls_progress': 'Calls done: {{done}} / ~{{total}}',
        'lab.step_progress': 'Step {{current}} / {{total}}',
        'lab.estimated_calls_with_search': 'Estimated: ~{{llm}} model calls + up to {{search}} searches',
        'lab.estimated_calls_no_search': 'Estimated: ~{{llm}} model calls',
        'lab.step_subquery_label': 'Search query:',
        'lab.step_sources_label': 'Sources for this step',
        'lab.rebase_from_session': 'Reuse as new research',
        'lab.spawn_step_to_canvas': 'Send step to canvas',
        'lab.spawn_step_done': 'Step on canvas',
        'lab.spawn_step_hint': 'Added to canvas',
        'lab.conclusion_label': 'Agent recommendation and conclusion:',
        'nodes.ai_loading': 'Synthesizing...',
      };
      let result = map[key] ?? key;
      if (opts) {
        Object.entries(opts).forEach(([k, v]) => {
          result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
        });
      }
      return result;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock search module
const mockMetasoSearch = vi.fn();
vi.mock('../../src/services/search', () => ({
  webSearch: (...args: any[]) => mockMetasoSearch(...args),
  buildSearchContext: (results: any) => {
    if (!results?.webpages?.length) return '';
    return results.webpages.map((w: any) => `[Source] ${w.title}: ${w.snippet}`).join('\n');
  },
}));

// Mock aiI18n
vi.mock('../../src/utils/aiI18n', () => ({
  getLocaleDirective: () => 'Reply in English.',
}));

const baseConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  baseUrl: '',
  model: 'gpt-4o',
};

const planJson3 = JSON.stringify([
  { title: 'Step 1', desc: 'Desc 1' },
  { title: 'Step 2', desc: 'Desc 2' },
  { title: 'Step 3', desc: 'Desc 3' },
]);

const reportJson = JSON.stringify({
  intro: 'Synth intro',
  points: [
    { title: 'P1', text: 'T1' },
    { title: 'P2', text: 'T2' },
    { title: 'P3', text: 'T3' },
  ],
  conclusion: 'Synth done',
});

type CallOpts = { prompt: string; onStreamChunk?: (acc: string) => void };

/**
 * 分步执行后 callAI 按 prompt 前缀路由：
 * 计划 → planJson；分类器 → need_web；子查询 → `subq`；分步分析 → `analysis-N`；汇总 → 报告 JSON。
 */
function makeRouterCallAI(overrides?: {
  plan?: string;
  synthesis?: () => string;
  onAnalysis?: (n: number, opts: CallOpts) => Promise<void> | void;
}) {
  let analysis = 0;
  return vi.fn().mockImplementation(async (opts: CallOpts) => {
    const { prompt } = opts;
    if (prompt.startsWith('Classifier')) return '{"need_web":true}';
    if (prompt.startsWith('Decompose question')) return overrides?.plan ?? planJson3;
    if (prompt.startsWith('Subquery step')) return 'subq';
    if (prompt.startsWith('Analyze step')) {
      analysis += 1;
      await overrides?.onAnalysis?.(analysis, opts);
      return `analysis-${analysis}`;
    }
    if (prompt.startsWith('Synthesize')) return overrides?.synthesis?.() ?? reportJson;
    throw new Error(`unexpected prompt: ${prompt.slice(0, 50)}`);
  });
}

async function submitTopic(topic: string) {
  const input = screen.getByPlaceholderText('Search topic...');
  fireEvent.change(input, { target: { value: topic } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => {
    expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
  });
}

describe('ResearchLab', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(openExternalUrl).mockClear().mockResolvedValue(undefined);
    await db.researchSessions.clear();
  });

  it('renders idle state with input', () => {
    const callAI = vi.fn();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);
    expect(screen.getByText('What would you like to investigate?')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search topic...')).toBeTruthy();
  });

  it('shows empty history message when no sessions in db', () => {
    const callAI = vi.fn();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);
    expect(screen.getByText('No completed research yet.')).toBeTruthy();
  });

  it('lists sessions from db and opens report on row click', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-1',
      query: 'Memory palace history',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'Step 1', desc: 'D' }],
      researchReport: {
        intro: 'Saved intro text',
        points: [{ title: 'Point A', text: 'Body A' }],
        conclusion: 'Saved conclusion',
      },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await waitFor(() => {
      expect(screen.getByTestId('research-session-sess-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-sess-1'));

    await waitFor(() => {
      expect(screen.getByText('Memory palace history')).toBeTruthy();
      expect(screen.getByText('Saved intro text')).toBeTruthy();
    });
  });

  it('deletes a session from IndexedDB after confirm', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-del',
      query: 'To delete',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'S', desc: 'D' }],
      researchReport: { intro: 'I', points: [], conclusion: 'C' },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await waitFor(() => {
      expect(screen.getByTestId('research-session-delete-sess-del')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-delete-sess-del'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(async () => {
      expect(await db.researchSessions.count()).toBe(0);
    });
  });

  it('does not delete a session when confirm is dismissed', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-keep',
      query: 'Keep me',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'S', desc: 'D' }],
      researchReport: { intro: 'I', points: [], conclusion: 'C' },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await waitFor(() => {
      expect(screen.getByTestId('research-session-delete-sess-keep')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-delete-sess-keep'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'dialog.cancel' }));

    expect(await db.researchSessions.count()).toBe(1);
  });

  it('calls callAI without search context when no search key', async () => {
    const callAI = vi.fn().mockResolvedValue(planJson3);
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'memory loss' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(1);
    });

    // No Metaso key → no need_web classifier call
    expect(mockMetasoSearch).not.toHaveBeenCalled();

    const prompt = callAI.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('[Source]');
    expect(prompt).not.toContain('Classifier');
    expect(prompt).toContain('memory loss');
  });

  it('generatePlan 传入 onStreamChunk 并显示流式大纲预览', async () => {
    const callAI = vi.fn().mockImplementation(async (opts: { onStreamChunk?: (t: string) => void }) => {
      opts.onStreamChunk?.('{"title":');
      opts.onStreamChunk?.(planJson3);
      return planJson3;
    });
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'streaming plan' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(1);
      expect(callAI.mock.calls[0][0].onStreamChunk).toEqual(expect.any(Function));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Step 1');
    });
  });

  it('calls webSearch when a search key is provided', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 1,
      webpages: [{ title: 'Research', link: 'https://r.com', snippet: 'Findings', score: 'high', date: '2026-01-01' }],
    });

    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":true}')
      .mockResolvedValue(planJson3);

    render(<ResearchLab aiConfig={{ ...baseConfig, searchApiKey: 'sk-metaso-test' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'AI research' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockMetasoSearch).toHaveBeenCalledWith('AI research', {
        kind: 'metaso',
        apiKey: 'sk-metaso-test',
      });
    });

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    expect((callAI.mock.calls[0][0].prompt as string)).toContain('Classifier');

    // callAI: classifier then plan; plan prompt SHOULD contain search context
    const prompt = callAI.mock.calls[1][0].prompt;
    expect(prompt).toContain('[Source]');
    expect(prompt).toContain('Findings');
  });

  it('opens source detail modal and calls openExternalUrl for system browser', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 1,
      webpages: [
        { title: 'Paper', link: 'https://example.com/doc', snippet: 'S', score: '', date: '' },
      ],
    });
    const callAI = vi.fn().mockResolvedValueOnce('{"need_web":true}').mockResolvedValueOnce(planJson3);

    render(<ResearchLab aiConfig={{ ...baseConfig, searchApiKey: 'sk-metaso' }} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'topic sources' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('lab-source-card-0')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('lab-source-card-0'));

    await waitFor(() => {
      expect(screen.getByTestId('lab-source-detail-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Open in browser/i }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/doc');
  });

  it('does not call metaso when classifier returns need_web false', async () => {
    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":false}')
      .mockResolvedValue(planJson3);

    render(<ResearchLab aiConfig={{ ...baseConfig, searchApiKey: 'sk-metaso-test' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'meaning of life' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    expect(mockMetasoSearch).not.toHaveBeenCalled();

    const planPrompt = callAI.mock.calls[1][0].prompt as string;
    expect(planPrompt).not.toContain('[Source]');
    expect(planPrompt).toContain('meaning of life');
  });

  it('degrades gracefully when webSearch fails', async () => {
    mockMetasoSearch.mockRejectedValue(new Error('Network error'));

    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":true}')
      .mockResolvedValue(planJson3);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ResearchLab aiConfig={{ ...baseConfig, searchApiKey: 'sk-bad-key' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    // Should have warned about search failure
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Metaso search failed'),
      expect.any(String)
    );

    // callAI prompt should NOT contain search context (graceful fallback)
    const prompt = callAI.mock.calls[1][0].prompt;
    expect(prompt).not.toContain('[Source]');

    consoleSpy.mockRestore();
  });

  it('shows a call-cost estimate next to the approve button', async () => {
    const callAI = makeRouterCallAI();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('estimate topic');

    // 无搜索 Key：3 步分析 + 1 汇总 = 4 次模型调用
    expect(screen.getByTestId('lab-cost-estimate').textContent).toContain('~4 model calls');
  });

  it('executes step by step: per-step analysis prompts carry the edited plan, prior findings relay, synthesis last', async () => {
    const callAI = makeRouterCallAI();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('memory loss');

    fireEvent.change(screen.getByLabelText('Step 1 title'), { target: { value: 'Edited step one' } });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // plan(1) + 3 analyses + synthesis(1) = 5
    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(5);
    });

    const prompts = callAI.mock.calls.map((c: any[]) => c[0].prompt as string);
    const analysisPrompts = prompts.filter((p) => p.startsWith('Analyze step'));
    expect(analysisPrompts).toHaveLength(3);
    expect(analysisPrompts[0]).toContain('Edited step one');
    expect(analysisPrompts[0]).toContain('memory loss');
    expect(analysisPrompts[0]).toContain('(no prior findings)');
    // 步骤接力：第 2、3 步吃到之前的结论
    expect(analysisPrompts[1]).toContain('analysis-1');
    expect(analysisPrompts[2]).toContain('analysis-2');
    // 汇总是最后一次调用，且带各步产出
    const last = prompts[prompts.length - 1];
    expect(last.startsWith('Synthesize')).toBe(true);
    expect(last).toContain('analysis-3');

    await waitFor(() => {
      expect(screen.getByText('Synth intro')).toBeTruthy();
    });
  });

  it('persists completed research session to IndexedDB', async () => {
    const callAI = makeRouterCallAI();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('persist query');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(5);
    });

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].query).toBe('persist query');
      expect(rows[0].researchReport.intro).toBe('Synth intro');
      expect(rows[0].researchReport.points).toHaveLength(3);
      expect(rows[0].searchStatus).toBe('idle');
      expect(rows[0].searchWebpages).toEqual([]);
    });
  });

  it('runs one search per step and persists merged deduped sources', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 3,
      webpages: [
        { title: 'A', link: 'https://a.com', snippet: 'Sa', score: '', date: '' },
        { title: 'B', link: 'https://b.com', snippet: 'Sb', score: '', date: '' },
        { title: 'C', link: 'https://c.com', snippet: 'Sc', score: '', date: '' },
      ],
    });
    const callAI = makeRouterCallAI();

    render(<ResearchLab aiConfig={{ ...baseConfig, searchApiKey: 'sk-m' }} callAI={callAI} />);

    await submitTopic('metaso topic');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // classifier + plan + 3×(subquery + analysis) + synthesis = 9
    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(9);
    });

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].searchStatus).toBe('found');
      // 三步来源重复，去重后仍是 3 条
      expect(rows[0].sourceCount).toBe(3);
      expect(rows[0].searchWebpages?.length).toBe(3);
      expect(rows[0].searchWebpages?.[0]?.link).toBe('https://a.com');
      expect(rows[0].researchReport.intro).toBe('Synth intro');
    });

    // 计划阶段 1 次 + 每步 1 次 = 4 次检索，检索词是改写后的子查询
    expect(mockMetasoSearch).toHaveBeenCalledTimes(4);
    expect(mockMetasoSearch.mock.calls[1][0]).toBe('subq');
    expect(mockMetasoSearch.mock.calls[2][0]).toBe('subq');
  });

  it('still shows report when persisting session fails', async () => {
    const addSpy = vi.spyOn(db.researchSessions, 'add').mockRejectedValueOnce(new Error('disk full'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const callAI = makeRouterCallAI();
      render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

      await submitTopic('q');
      fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

      await waitFor(() => {
        expect(screen.getByText('Synth intro')).toBeTruthy();
      });

      expect(errSpy).toHaveBeenCalledWith(
        '[Spoor:research] ResearchLab failed to persist session',
        expect.any(Error),
      );

      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('ignores second Approve while executeResearch is in flight', async () => {
    let releaseAnalysis!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAnalysis = res;
    });
    const callAI = makeRouterCallAI({
      onAnalysis: async (n) => {
        if (n === 1) await gate;
      },
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('t');

    const approveBtn = screen.getByRole('button', { name: /Approve & Execute/i });
    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    // plan + first analysis (gated) — 第二次点击不应再启动一轮
    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    releaseAnalysis();

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
    });

    // plan + 3 analyses + synthesis
    expect(callAI).toHaveBeenCalledTimes(5);
  });

  it('stop button aborts the run, keeps finished step output on screen, persists nothing', async () => {
    let releaseAnalysis!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAnalysis = res;
    });
    const callAI = makeRouterCallAI({
      onAnalysis: async (n) => {
        if (n === 2) await gate;
      },
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('stop me');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // 第一步完成后其分析出现在界面上
    await waitFor(() => {
      expect(screen.getByText('analysis-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('lab-stop-run'));
    releaseAnalysis();

    await waitFor(() => {
      expect(screen.getByTestId('lab-run-stopped')).toBeTruthy();
    });

    // 已完成步骤的产出保留，且后续调用（第 3 步、汇总）没有发生
    expect(screen.getByText('analysis-1')).toBeTruthy();
    // plan + analysis1 + analysis2（中断发生在这次调用内）
    expect(callAI).toHaveBeenCalledTimes(3);
    const prompts = callAI.mock.calls.map((c: any[]) => c[0].prompt as string);
    expect(prompts.some((p) => p.startsWith('Synthesize'))).toBe(false);

    expect(await db.researchSessions.count()).toBe(0);

    // 「返回大纲」回到可编辑计划
    fireEvent.click(screen.getByTestId('lab-back-to-plan'));
    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });
  });

  it('calls AI to revise plan from the revision textarea', async () => {
    const initialPlan = planJson3;
    const revisedPlan = JSON.stringify([{ title: 'Only one step', desc: 'Condensed' }]);
    const callAI = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValueOnce(revisedPlan);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('topic t');

    fireEvent.change(screen.getByPlaceholderText('Revision instructions...'), {
      target: { value: 'Merge everything into one step' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update outline with AI/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    const revisePrompt = callAI.mock.calls[1][0].prompt as string;
    expect(revisePrompt).toContain('Merge everything into one step');
    expect(revisePrompt).toContain('Step 1');

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Only one step');
    });
  });

  it('does not persist session when synthesis JSON is invalid; retry re-runs and persists', async () => {
    let attempt = 0;
    const callAI = makeRouterCallAI({
      synthesis: () => {
        attempt += 1;
        return attempt === 1 ? 'NOT VALID JSON { broken' : reportJson;
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

      await submitTopic('retry topic');
      fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

      await waitFor(() => {
        expect(screen.getByTestId('lab-retry-report')).toBeTruthy();
      });

      let rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(0);

      fireEvent.click(screen.getByTestId('lab-retry-report'));

      await waitFor(() => {
        expect(screen.getByText('Synth intro')).toBeTruthy();
      });

      await waitFor(async () => {
        rows = await db.researchSessions.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].researchReport.intro).toBe('Synth intro');
      });

      // plan + (3 analyses + synth) ×2
      expect(callAI).toHaveBeenCalledTimes(9);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('reuse-as-new-research from a history session returns to an editable outline', async () => {
    const callAI = makeRouterCallAI();
    await db.researchSessions.add({
      id: 'sess-rebase',
      query: 'Old research question',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [
        { title: 'Old step 1', desc: 'od1' },
        { title: 'Old step 2', desc: 'od2' },
      ],
      researchReport: { intro: 'Old intro', points: [{ title: 'P', text: 'T' }], conclusion: 'Old c' },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await waitFor(() => {
      expect(screen.getByTestId('research-session-sess-rebase')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('research-session-sess-rebase'));

    await waitFor(() => {
      expect(screen.getByTestId('lab-rebase-session')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('lab-rebase-session'));

    // query 与 plan 已填回，且都可编辑
    await waitFor(() => {
      expect(screen.getByTestId('lab-query-input')).toHaveValue('Old research question');
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Old step 1');
    });

    fireEvent.change(screen.getByTestId('lab-query-input'), {
      target: { value: 'Refined research question' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // 2 步分析 + 汇总（无搜索 Key，也无分类器）
    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(3);
    });

    const analysisPrompt = callAI.mock.calls[0][0].prompt as string;
    expect(analysisPrompt.startsWith('Analyze step')).toBe(true);
    expect(analysisPrompt).toContain('Refined research question');

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows.some((r) => r.query === 'Refined research question')).toBe(true);
    });
  });

  it('uses fallback plan when model returns empty or invalid JSON', async () => {
    const callAI = vi.fn().mockResolvedValueOnce('[]');

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const topicInput = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(topicInput, { target: { value: 'topic' } });
    fireEvent.submit(topicInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('lab.plan_fallback.step1_title');
    });
    expect(callAI).toHaveBeenCalledTimes(1);
  });

  it('does not render per-step spawn buttons when onSpawnStepToCanvas is absent', async () => {
    let releaseAnalysis!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAnalysis = res;
    });
    const callAI = makeRouterCallAI({
      onAnalysis: async (n) => {
        if (n === 2) await gate;
      },
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    await submitTopic('no spawn wiring');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // 第一步已完成（analysis-1 在屏），但 App 没接回调 → 不渲染落卡按钮
    await waitFor(() => {
      expect(screen.getByText('analysis-1')).toBeTruthy();
    });
    expect(screen.queryByTestId('lab-run-step-0-spawn')).toBeNull();

    releaseAnalysis();
    await waitFor(async () => {
      expect(await db.researchSessions.count()).toBe(1);
    });
  });

  it('spawns a finished step to canvas with its sources, marks it spawned and shows a hint', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 3,
      webpages: [
        { title: 'A', link: 'https://a.com', snippet: 'Sa', score: '', date: '' },
        { title: 'B', link: 'https://b.com', snippet: 'Sb', score: '', date: '' },
        { title: 'C', link: 'https://c.com', snippet: 'Sc', score: '', date: '' },
      ],
    });
    const onSpawnStepToCanvas = vi.fn().mockResolvedValue(undefined);
    let releaseAnalysis!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAnalysis = res;
    });
    const callAI = makeRouterCallAI({
      onAnalysis: async (n) => {
        if (n === 2) await gate;
      },
    });

    render(
      <ResearchLab
        aiConfig={{ ...baseConfig, searchApiKey: 'sk-m' }}
        callAI={callAI}
        onSpawnStepToCanvas={onSpawnStepToCanvas}
      />,
    );

    await submitTopic('spawn step topic');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    // 第一步已完成 → 有落卡按钮；第二步执行中 → 没有
    await waitFor(() => {
      expect(screen.getByTestId('lab-run-step-0-spawn')).toBeTruthy();
    });
    expect(screen.queryByTestId('lab-run-step-1-spawn')).toBeNull();

    fireEvent.click(screen.getByTestId('lab-run-step-0-spawn'));

    await waitFor(() => {
      expect(onSpawnStepToCanvas).toHaveBeenCalledTimes(1);
    });
    expect(onSpawnStepToCanvas).toHaveBeenCalledWith({
      title: 'Step 1',
      analysis: 'analysis-1',
      sources: [
        { title: 'A', link: 'https://a.com', snippet: 'Sa' },
        { title: 'B', link: 'https://b.com', snippet: 'Sb' },
        { title: 'C', link: 'https://c.com', snippet: 'Sc' },
      ],
    });

    // 已落状态 + 轻提示；再点不再触发
    await waitFor(() => {
      expect(screen.getByTestId('lab-run-step-0-spawn')).toBeDisabled();
    });
    expect(screen.getByTestId('lab-run-step-0-spawn').textContent).toContain('Step on canvas');
    expect(screen.getByTestId('lab-run-step-0-spawn-hint')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lab-run-step-0-spawn'));
    expect(onSpawnStepToCanvas).toHaveBeenCalledTimes(1);

    releaseAnalysis();
    await waitFor(() => {
      expect(screen.getByText('Synth intro')).toBeTruthy();
    });
  });

  it('spawn buttons stay available for finished steps after the run is stopped', async () => {
    const onSpawnStepToCanvas = vi.fn().mockResolvedValue(undefined);
    let releaseAnalysis!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAnalysis = res;
    });
    const callAI = makeRouterCallAI({
      onAnalysis: async (n) => {
        if (n === 2) await gate;
      },
    });

    render(
      <ResearchLab aiConfig={baseConfig} callAI={callAI} onSpawnStepToCanvas={onSpawnStepToCanvas} />,
    );

    await submitTopic('stop then spawn');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(screen.getByText('analysis-1')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('lab-stop-run'));
    releaseAnalysis();

    await waitFor(() => {
      expect(screen.getByTestId('lab-run-stopped')).toBeTruthy();
    });

    // 已完成的第一步仍可落卡（无搜索 Key → 来源为空数组）
    fireEvent.click(screen.getByTestId('lab-run-step-0-spawn'));
    await waitFor(() => {
      expect(onSpawnStepToCanvas).toHaveBeenCalledWith({
        title: 'Step 1',
        analysis: 'analysis-1',
        sources: [],
      });
    });
  });

  it('keeps plan unchanged when AI revision returns empty array', async () => {
    const planJson = JSON.stringify([{ title: 'Step 1', desc: 'Desc 1' }]);
    const callAI = vi.fn().mockResolvedValueOnce(planJson).mockResolvedValueOnce('[]');

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 't' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => screen.getByPlaceholderText('Revision instructions...'));

    fireEvent.change(screen.getByPlaceholderText('Revision instructions...'), {
      target: { value: 'please break this' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update outline with AI/i }));

    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Step 1');
    });
    expect(screen.getByPlaceholderText('Revision instructions...')).toHaveValue('please break this');
  });
});
