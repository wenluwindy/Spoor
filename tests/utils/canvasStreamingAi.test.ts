import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { runCanvasStreamingAiCall } from '../../src/utils/canvasStreamingAi';
import {
  getAiStreamText,
  resetAiStreamStoreForTests,
} from '../../src/services/aiStreamStore';

describe('runCanvasStreamingAiCall', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.aiTurns.clear();
    resetAiStreamStoreForTests();
  });

  it('streams updates then writes final content', async () => {
    await db.nodes.add({
      id: 'n1',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const updates: string[] = [];
    const origUpdate = db.nodes.update.bind(db.nodes);
    vi.spyOn(db.nodes, 'update').mockImplementation(((id, changes) => {
      if (typeof changes === 'object' && changes && 'content' in changes) {
        updates.push(String(changes.content));
      }
      return origUpdate(id, changes);
    }) as typeof db.nodes.update);

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n1',
      throttleMs: 0,
      callAi: async (onStream) => {
        onStream('Hel');
        onStream('Hello');
        return 'Hello';
      },
    });

    expect(result).toBe('Hello');
    const row = await db.nodes.get('n1');
    expect(row?.content).toBe('Hello');
    // 中间态不落库：整个流式过程只有完成时那一次 content 写入
    expect(updates).toEqual(['Hello']);
  });

  it('流式中间态进内存 store，完成落库后延迟清掉', async () => {
    await db.nodes.add({ id: 'ns', canvasId: 'default', type: 'ai', content: '', x: 0, y: 0 });

    const seen: (string | undefined)[] = [];
    await runCanvasStreamingAiCall({
      nodeId: 'ns',
      throttleMs: 0,
      cleanupDelayMs: 0,
      callAi: async (onStream) => {
        onStream('片');
        seen.push(getAiStreamText('ns'));
        // 节流器对同一 tick 里的第二次调用走 trailing 定时器，让出一个宏任务再读
        await new Promise((r) => setTimeout(r, 5));
        onStream('片段');
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getAiStreamText('ns'));
        return '片段';
      },
    });

    expect(seen).toEqual(['片', '片段']);
    // 落库后暂存延迟清（等 live query 送回最终行）；这里注入 0 延迟，一个宏任务后就该没了
    await new Promise((r) => setTimeout(r, 10));
    expect(getAiStreamText('ns')).toBeUndefined();
    expect((await db.nodes.get('ns'))?.content).toBe('片段');
  });

  it('deletes placeholder when response empty', async () => {
    await db.nodes.add({
      id: 'n2',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n2',
      callAi: async () => '   ',
    });

    expect(result).toBe('');
    expect(await db.nodes.get('n2')).toBeUndefined();
  });

  it('deletes node on failure', async () => {
    await db.nodes.add({
      id: 'n3',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    await expect(
      runCanvasStreamingAiCall({
        nodeId: 'n3',
        throttleMs: 0,
        callAi: async (onStream) => {
          onStream('半截');
          throw new Error('fail');
        },
      }),
    ).rejects.toThrow('fail');

    expect(await db.nodes.get('n3')).toBeUndefined();
    // 失败时内存暂存立刻清掉，不留幽灵文本
    expect(getAiStreamText('n3')).toBeUndefined();
  });

  it('ai 卡每次成功生成落一条 aiTurns 历史，带上下文快照', async () => {
    await db.nodes.add({
      id: 'nt',
      canvasId: 'c1',
      type: 'ai',
      content: '',
      userTurn: '为什么？',
      threadAgentConfigId: 'agent-1',
      x: 0,
      y: 0,
    });

    await runCanvasStreamingAiCall({ nodeId: 'nt', throttleMs: 0, cleanupDelayMs: 0, callAi: async () => '第一版' });
    await runCanvasStreamingAiCall({ nodeId: 'nt', throttleMs: 0, cleanupDelayMs: 0, mode: 'regenerate', callAi: async () => '第二版' });

    const turns = await db.aiTurns.where('nodeId').equals('nt').sortBy('createdAt');
    expect(turns.map((tu) => tu.content)).toEqual(['第一版', '第二版']);
    expect(turns[0]).toMatchObject({ canvasId: 'c1', userTurn: '为什么？', agentConfigId: 'agent-1' });
    expect((await db.nodes.get('nt'))?.content).toBe('第二版');
  });

  it('非 ai 类型的节点不记历史', async () => {
    await db.nodes.add({ id: 'plain', canvasId: 'c1', type: 'text', content: '', x: 0, y: 0 });
    await runCanvasStreamingAiCall({ nodeId: 'plain', throttleMs: 0, cleanupDelayMs: 0, callAi: async () => '正文' });
    expect(await db.aiTurns.count()).toBe(0);
  });

  it('regenerate 模式：失败时留住旧内容与节点，不删卡', async () => {
    await db.nodes.add({ id: 'nr', canvasId: 'c1', type: 'ai', content: '旧回答', x: 0, y: 0 });

    await expect(
      runCanvasStreamingAiCall({
        nodeId: 'nr',
        throttleMs: 0,
        mode: 'regenerate',
        callAi: async () => {
          throw new Error('网络挂了');
        },
      }),
    ).rejects.toThrow('网络挂了');

    // 0.3.x 在这里会把整张卡删掉——重生成失败不该是数据丢失
    expect((await db.nodes.get('nr'))?.content).toBe('旧回答');
  });

  it('regenerate 模式：模型返回空时同样留住旧内容', async () => {
    await db.nodes.add({ id: 'ne', canvasId: 'c1', type: 'ai', content: '旧回答', x: 0, y: 0 });
    const result = await runCanvasStreamingAiCall({
      nodeId: 'ne',
      throttleMs: 0,
      mode: 'regenerate',
      callAi: async () => '   ',
    });
    expect(result).toBe('');
    expect((await db.nodes.get('ne'))?.content).toBe('旧回答');
  });
});
