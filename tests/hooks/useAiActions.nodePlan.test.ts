import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { db } from '../../src/db';
import { useAiActions } from '../../src/hooks/useAiActions';
import type { AIConfig } from '../../src/components/AISettingsModal';

const planCanvasNodes = vi.hoisted(() => vi.fn());
const callUniversalAI = vi.hoisted(() => vi.fn());
const runCanvasStreamingAiCall = vi.hoisted(() => vi.fn());
const appAlert = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
  // useAiActions 经 utils/file 拉到 i18n 单例，单例 init 时要用它
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('../../src/services/canvasNodePlanner', () => ({ planCanvasNodes }));

vi.mock('../../src/services/ai', () => ({
  callUniversalAI,
  formatAiError: (e: unknown) => String(e),
  maskApiKeyForLog: () => '***',
}));

vi.mock('../../src/utils/canvasStreamingAi', () => ({ runCanvasStreamingAiCall }));

vi.mock('../../src/components/AppDialogProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/AppDialogProvider')>()),
  useAppDialog: () => ({ alert: appAlert, confirm: vi.fn() }),
}));

vi.mock('../../src/utils/aiI18n', () => ({
  combineSystemParts: (...parts: string[]) => parts.join('\n'),
  getLocaleDirective: () => 'zh',
  buildAgentSystemInstruction: () => '',
  resolveAgentLocalizedName: (a: { name: string }) => a.name,
}));

const AI_CONFIG = { provider: 'openai', apiKey: 'k', model: 'm' } as unknown as AIConfig;

function setup() {
  return renderHook(() =>
    useAiActions({
      aiConfig: AI_CONFIG,
      agentConfigs: [],
      activeCanvasId: 'default',
      nodesRef: { current: {} },
      transformRef: { current: { x: 0, y: 0, scale: 1 } },
      dynamicNodes: [],
      edges: [],
      selectedNodes: new Set<string>(),
      setSelectedNodes: vi.fn(),
      setActiveReferenceId: vi.fn(),
      setActiveTab: vi.fn(),
    }),
  );
}

async function submit(result: { current: ReturnType<typeof useAiActions> }, text: string) {
  act(() => result.current.setAiPrompt(text));
  await act(async () => {
    await result.current.handleAiSubmit();
  });
}

describe('useAiActions —— 自然语言建节点', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.nodes.clear();
    await db.edges.clear();
    runCanvasStreamingAiCall.mockResolvedValue('回答正文');
  });

  it('命中「建便签」时按计划落库，且不生成 AI 卡', async () => {
    planCanvasNodes.mockResolvedValue({
      action: 'create',
      nodes: [
        { type: 'text', content: '早上：写提纲' },
        { type: 'theme', content: '本周主线' },
      ],
    });

    const { result } = setup();
    await submit(result, '建两个便签：早上写提纲；再来一张主题卡');

    const nodes = await db.nodes.toArray();
    expect(nodes).toHaveLength(2);
    // 主键是 UUID，toArray 的顺序按 id 排而不是插入顺序，所以比集合而非序列
    expect(new Set(nodes.map((n) => `${n.type}:${n.content}`))).toEqual(
      new Set(['text:早上：写提纲', 'theme:本周主线']),
    );
    expect(runCanvasStreamingAiCall).not.toHaveBeenCalled();
  });

  it('落库的节点带当前 canvasId 与各自不同的坐标', async () => {
    planCanvasNodes.mockResolvedValue({
      action: 'create',
      nodes: [
        { type: 'text', content: 'a' },
        { type: 'text', content: 'b' },
      ],
    });

    const { result } = setup();
    await submit(result, '建两个便签');

    const nodes = await db.nodes.toArray();
    expect(nodes.every((n) => n.canvasId === 'default')).toBe(true);
    expect(nodes[0].x).not.toBe(nodes[1].x);
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('建完清空输入框', async () => {
    planCanvasNodes.mockResolvedValue({
      action: 'create',
      nodes: [{ type: 'text', content: 'a' }],
    });

    const { result } = setup();
    await submit(result, '建一个便签');
    expect(result.current.aiPrompt).toBe('');
  });

  it('粗筛没命中就不调用规划器，直接走问答', async () => {
    const { result } = setup();
    await submit(result, '帮我解释一下量子纠缠');

    expect(planCanvasNodes).not.toHaveBeenCalled();
    expect(runCanvasStreamingAiCall).toHaveBeenCalledTimes(1);
  });

  it('规划器判定为问答时退回生成 AI 卡', async () => {
    planCanvasNodes.mockResolvedValue({ action: 'answer' });

    const { result } = setup();
    await submit(result, '便签怎么建？');

    expect(planCanvasNodes).toHaveBeenCalledTimes(1);
    expect(runCanvasStreamingAiCall).toHaveBeenCalledTimes(1);
  });

  it('规划调用抛错时不挡住用户，退回问答', async () => {
    planCanvasNodes.mockRejectedValue(new Error('network'));

    const { result } = setup();
    await submit(result, '建三个便签');

    expect(runCanvasStreamingAiCall).toHaveBeenCalledTimes(1);
    // 只留问答流程建的那张 AI 卡，没有半途落下的便签
    expect((await db.nodes.toArray()).map((n) => n.type)).toEqual(['ai']);
  });

  it('空输入什么都不做', async () => {
    const { result } = setup();
    await submit(result, '   ');

    expect(planCanvasNodes).not.toHaveBeenCalled();
    expect(runCanvasStreamingAiCall).not.toHaveBeenCalled();
  });
});
