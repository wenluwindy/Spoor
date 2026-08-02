import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Canvas, type CanvasNode } from '../../src/db';
import {
  buildCanvasMirrorContent,
  canvasMirrorFileName,
  mirrorFileToRows,
  parseCanvasMirrorFile,
  buildGlobalMirrorContent,
  parseGlobalMirrorFile,
} from '../../src/services/canvasMirror';
import {
  MIRROR_DEBOUNCE_MS,
  startMirrorScheduler,
  type MirrorIo,
} from '../../src/services/mirrorScheduler';
import { resetMirrorSignalsForTests } from '../../src/services/mirrorSignals';

const CANVAS: Canvas = { id: 'c1', name: '测试画布', createdAt: 100, updatedAt: 200 };

const NODES: CanvasNode[] = [
  { id: 'n1', canvasId: 'c1', type: 'text', content: '便签', x: 0, y: 0, updatedAt: 10, tags: ['a'] },
  {
    id: 'n2',
    canvasId: 'c1',
    type: 'ai',
    content: '原始回答',
    userTurn: '追问',
    x: 100,
    y: 0,
    updatedAt: 20,
    threadAgentConfigId: 'agent-1',
  },
  { id: 'n3', canvasId: 'c1', type: 'theme', content: '标题', description: '说明', x: 200, y: 0 },
];

function buildContent() {
  return buildCanvasMirrorContent({
    canvas: CANVAS,
    nodes: NODES,
    edges: [{ id: 'e1', canvasId: 'c1', from: 'n1', to: 'n2' }],
    aiTurns: [{ id: 't1', nodeId: 'n2', canvasId: 'c1', content: '第一版', createdAt: 5 }],
    revision: 3,
    savedAt: 999,
  });
}

describe('canvasMirror 序列化', () => {
  it('顶层是合法 JSON Canvas（nodes/edges），Spoor 信息在额外键里', () => {
    const parsed = JSON.parse(buildContent());
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.spoorMeta).toMatchObject({ canvasId: 'c1', revision: 3, savedAt: 999 });
    expect(parsed.spoorAiTurns).toHaveLength(1);
  });

  it('往返保真：id 保留、ai 卡 content 是原始值而非投影、aiTurns 回得来', () => {
    const file = parseCanvasMirrorFile(buildContent())!;
    const { nodes, edges, aiTurns } = mirrorFileToRows(file);

    expect(nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    const ai = nodes.find((n) => n.id === 'n2')!;
    // ai 卡的 text 投影是 "> 追问\n\n原始回答"——回来的必须是原始 content
    expect(ai.content).toBe('原始回答');
    expect(ai.userTurn).toBe('追问');
    expect(ai.threadAgentConfigId).toBe('agent-1');
    const theme = nodes.find((n) => n.id === 'n3')!;
    expect(theme.content).toBe('标题');
    expect(theme.description).toBe('说明');
    expect(nodes.find((n) => n.id === 'n1')).toMatchObject({ tags: ['a'], updatedAt: 10 });

    expect(edges).toEqual([{ id: 'e1', canvasId: 'c1', from: 'n1', to: 'n2' }]);
    expect(aiTurns).toEqual([{ id: 't1', nodeId: 'n2', canvasId: 'c1', content: '第一版', createdAt: 5 }]);
  });

  it('半截/非镜像文件返回 null，不炸', () => {
    expect(parseCanvasMirrorFile('{ "nodes": [')).toBeNull();
    expect(parseCanvasMirrorFile('{"nodes": [], "edges": []}')).toBeNull(); // 无 spoorMeta：用户手放的普通 .canvas
    expect(parseCanvasMirrorFile('"just a string"')).toBeNull();
  });

  it('全局表镜像往返', () => {
    const content = buildGlobalMirrorContent('articles', [{ id: 'a1', title: 'T' } as never], 2, 7);
    const parsed = parseGlobalMirrorFile(content)!;
    expect(parsed).toMatchObject({ scope: 'articles', revision: 2, savedAt: 7 });
    expect(parsed.rows).toHaveLength(1);
    expect(parseGlobalMirrorFile('{}')).toBeNull();
  });
});

describe('mirrorScheduler', () => {
  beforeEach(async () => {
    resetMirrorSignalsForTests();
    await Promise.all([
      db.nodes.clear(), db.edges.clear(), db.aiTurns.clear(),
      db.canvases.clear(), db.mirrorState.clear(),
    ]);
  });

  function fakeIo() {
    const writes: { name: string; content: string }[] = [];
    const removed: string[] = [];
    const io: MirrorIo = {
      write: async (name, content) => void writes.push({ name, content }),
      remove: async (name) => void removed.push(name),
    };
    return { io, writes, removed };
  }

  it('写库触发防抖落盘：连续多次编辑只写一次，revision 递增', async () => {
    const { io, writes } = fakeIo();
    const handle = startMirrorScheduler({ io, debounceMs: 10 });
    try {
      await db.canvases.add({ ...CANVAS });
      await db.nodes.add({ id: 'n1', canvasId: 'c1', type: 'text', content: 'a', x: 0, y: 0 });
      await db.nodes.update('n1', { content: 'b' });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();

      const c1Writes = writes.filter((w) => w.name === canvasMirrorFileName('c1'));
      expect(c1Writes).toHaveLength(1);
      const file = parseCanvasMirrorFile(c1Writes[0].content)!;
      expect(file.spoorMeta.revision).toBe(1);
      expect(mirrorFileToRows(file).nodes[0].content).toBe('b');
      expect((await db.mirrorState.get('c1'))?.revision).toBe(1);

      // 第二轮编辑 → revision 2
      await db.nodes.update('n1', { content: 'c' });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      const again = writes.filter((w) => w.name === canvasMirrorFileName('c1'));
      expect(again).toHaveLength(2);
      expect(parseCanvasMirrorFile(again[1].content)!.spoorMeta.revision).toBe(2);
    } finally {
      handle.stop();
    }
  });

  it('镜像自己的记账写入不再触发镜像（无自激循环）', async () => {
    const { io, writes } = fakeIo();
    const handle = startMirrorScheduler({ io, debounceMs: 10 });
    try {
      await db.canvases.add({ ...CANVAS });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      const count = writes.length;
      // 静置两个防抖窗口：记账写入若触发了信号，这里会多出写入
      await new Promise((r) => setTimeout(r, 40));
      await handle.flushNow();
      expect(writes.length).toBe(count);
    } finally {
      handle.stop();
    }
  });

  it('画布删除后清掉镜像文件与记账', async () => {
    const { io, removed } = fakeIo();
    const handle = startMirrorScheduler({ io, debounceMs: 10 });
    try {
      await db.canvases.add({ ...CANVAS });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      await db.canvases.delete('c1');
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      expect(removed).toContain(canvasMirrorFileName('c1'));
      expect(await db.mirrorState.get('c1')).toBeUndefined();
    } finally {
      handle.stop();
    }
  });

  it('写盘失败的作用域保留脏标记，下轮重试成功', async () => {
    let failOnce = true;
    const writes: string[] = [];
    const io: MirrorIo = {
      write: async (name) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('disk full');
        }
        writes.push(name);
      },
      remove: async () => {},
    };
    const handle = startMirrorScheduler({ io, debounceMs: 10 });
    try {
      await db.canvases.add({ ...CANVAS });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      expect(writes).toHaveLength(0);
      // 该画布再次变化 → 上次失败的会随本轮一起重写
      await db.canvases.update('c1', { name: '改名' });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      expect(writes).toContain(canvasMirrorFileName('c1'));
    } finally {
      handle.stop();
    }
  });

  it('全局表（长文）变化落到 articles.json', async () => {
    const { io, writes } = fakeIo();
    const handle = startMirrorScheduler({ io, debounceMs: 10 });
    try {
      await db.articles.add({ id: 'a1', title: 'T', content: '正文', date: '2026', type: 'x' });
      await new Promise((r) => setTimeout(r, 30));
      await handle.flushNow();
      const hit = writes.find((w) => w.name === 'articles.json');
      expect(hit).toBeTruthy();
      expect(parseGlobalMirrorFile(hit!.content)!.rows[0]).toMatchObject({ id: 'a1' });
    } finally {
      handle.stop();
    }
  });

  it('MIRROR_DEBOUNCE_MS 是产品值 2s（这里只固定契约，测试用注入的短窗口）', () => {
    expect(MIRROR_DEBOUNCE_MS).toBe(2000);
  });
});
