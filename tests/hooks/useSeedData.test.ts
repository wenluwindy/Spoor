import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSeedData } from '../../src/hooks/useSeedData';
import { resetBuiltinAgentsInDb } from '../../src/dev/resetBuiltinAgents';
import { db } from '../../src/db';
import i18n from '../../src/i18n';

describe('useSeedData', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agentSandboxThreads.clear();
  });

  it('首次运行创建默认画布', async () => {
    renderHook(() => useSeedData());
    // 等待 useEffect 异步操作完成
    await new Promise(r => setTimeout(r, 300));

    const canvas = await db.canvases.get('default');
    expect(canvas).toBeDefined();
    expect(canvas?.name).toBe('Main Workspace');
  });

  it('首次运行创建系统 agents', async () => {
    renderHook(() => useSeedData());
    await new Promise(r => setTimeout(r, 300));

    const agents = await db.agents.toArray();
    const roles = agents.map(a => a.role);
    expect(roles).toContain('Journalist');
    expect(roles).toContain('Connector');
    expect(roles).toContain('Editor');
    expect(roles).toContain('Visionary');
  });

  it('首次运行创建示例节点和边', async () => {
    renderHook(() => useSeedData());
    await new Promise(r => setTimeout(r, 300));

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.some(n => n.type === 'theme')).toBe(true);

    const edges = await db.edges.toArray();
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });

  it('已存在数据时不重复创建', async () => {
    // 预先插入默认画布和 agents，模拟已完成种子初始化的状态
    await db.canvases.add({
      id: 'default',
      name: 'Main Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.agents.bulkPut([
      { id: 'interviewer', name: 'The Mirror of Insight', role: 'Journalist', prompt: '', temperature: 0.7, creativity: 0.4 },
      { id: 'synthesizer', name: 'The Weaver', role: 'Connector', prompt: '', temperature: 0.8, creativity: 0.7 },
      { id: 'stylist', name: 'The Smoothing Iron', role: 'Editor', prompt: '', temperature: 0.6, creativity: 0.5 },
      { id: 'futurist', name: 'The Star-Gazer', role: 'Visionary', prompt: '', temperature: 0.9, creativity: 0.9 },
    ]);

    renderHook(() => useSeedData());
    await new Promise(r => setTimeout(r, 300));

    const canvases = await db.canvases.toArray();
    expect(canvases.length).toBe(1);

    // agents 已存在不会重复插入，但 nodes 和 articles 仍会创建（因为 nodeCount=0）
    const agents = await db.agents.toArray();
    expect(agents.length).toBe(4);

    // 因为 nodeCount=0 且 totalCount<=4，种子逻辑仍会创建 nodes 和 articles
    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('启动时移除已废弃的内置 id challenger', async () => {
    await db.agents.put({
      id: 'challenger',
      name: 'The Touchstone',
      role: 'Debater',
      prompt: 'legacy',
      temperature: 0.7,
      creativity: 0.4,
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));
    expect(await db.agents.get('challenger')).toBeUndefined();
  });

  it('启动时移除已废弃的内置 id pragmatist', async () => {
    await db.agents.put({
      id: 'pragmatist',
      name: 'The Heartwood',
      role: 'Realist',
      prompt: 'legacy',
      temperature: 0.4,
      creativity: 0.2,
    });
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));
    expect(await db.agents.get('pragmatist')).toBeUndefined();
  });

  /**
   * 开发者本地同步：等同于从 IndexedDB 删除内置行后再刷新，`useSeedData` 应按当前语言重写字段。
   * @see `globalThis.__SCRIBE_RESET_BUILTIN_AGENTS`（仅 dev）。
   */
  it('清空内置 Agent 后为缺失 ID 按 i18n 重灌默认值', async () => {
    await i18n.changeLanguage('en');
    await db.agents.put({
      id: 'futurist',
      name: 'The Futurist (stale)',
      role: 'Visionary (stale)',
      prompt: 'stale',
      temperature: 0.9,
      creativity: 0.9,
    });
    await resetBuiltinAgentsInDb();
    renderHook(() => useSeedData());
    await new Promise((r) => setTimeout(r, 300));

    const row = await db.agents.get('futurist');
    expect(row?.name).toBe(i18n.t('agents.defaults.futurist.name'));
    expect(row?.role).toBe(i18n.t('agents.defaults.futurist.role'));
    expect(row?.prompt).toBe(i18n.t('agents.defaults.futurist.prompt'));
  });
});
