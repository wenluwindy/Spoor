import { db } from '../db';
import { createThrottle } from './aiStreamThrottle';
import { clearAiStreamText, setAiStreamText } from '../services/aiStreamStore';

export const DEFAULT_STREAM_THROTTLE_MS = 100;

/**
 * 落库完成后再过多久清掉内存暂存：live query 把最终行送回组件要一两帧，
 * 立刻清会让卡片先闪回旧 content 再跳到新的。
 */
export const STREAM_TEXT_CLEANUP_DELAY_MS = 400;

export function createStreamChunkWriter(
  nodeId: string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  // 中间态只进内存 store，不写库：写库会惊动整张画布的 live query（见 aiStreamStore）。
  const throttle = createThrottle((content: string) => {
    setAiStreamText(nodeId, content);
  }, throttleMs);

  return {
    onStreamChunk: (accumulated) => throttle.call(accumulated),
    flush: async () => {
      throttle.flush();
    },
    cancel: () => throttle.cancel(),
  };
}

export type CanvasStreamingAiCallParams = {
  nodeId: string;
  callAi: (onStreamChunk: (accumulated: string) => void) => Promise<string>;
  throttleMs?: number;
  /** 仅供测试注入：正式代码用默认值。 */
  cleanupDelayMs?: number;
  /**
   * - 'create'（默认）：卡是为本次生成新建的，空结果/失败时删掉——空壳没有意义。
   * - 'regenerate'：卡上已有内容，空结果/失败时**原样留着**。0.3.x 这里也走删卡，
   *   重新生成一旦失败连旧回答一起没了，这是数据丢失，不是清理。
   */
  mode?: 'create' | 'regenerate';
};

/**
 * 生成完成后给 AI 卡记一条历史（aiTurns 表，v5 起）。
 * 与生图节点的 `imageGenResults` 对齐心智：重跑不再毁掉旧回答，翻历史随时找回。
 * 只有 type === 'ai' 的卡记；工具栏落的便签之类不进历史。
 */
async function recordAiTurn(nodeId: string, content: string): Promise<void> {
  const node = await db.nodes.get(nodeId);
  if (!node || node.type !== 'ai') return;
  await db.aiTurns.add({
    id: crypto.randomUUID(),
    nodeId,
    canvasId: node.canvasId || 'default',
    content,
    userTurn: node.userTurn,
    agentConfigId: node.threadAgentConfigId ?? node.agentConfigId,
    createdAt: Date.now(),
  });
}

/**
 * 跑一次流式 AI 生成：中间态进内存 store，**只有完成时才写库一次**；
 * 模型返回空文本或抛错时删掉节点（这张卡从没拥有过内容，留个空壳没有意义）。
 * 返回最终文本（空串表示模型什么都没给）。
 */
export async function runCanvasStreamingAiCall({
  nodeId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
  cleanupDelayMs = STREAM_TEXT_CLEANUP_DELAY_MS,
  mode = 'create',
}: CanvasStreamingAiCallParams): Promise<string> {
  const writer = createStreamChunkWriter(nodeId, throttleMs);
  try {
    const text = await callAi(writer.onStreamChunk);
    await writer.flush();
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      writer.cancel();
      clearAiStreamText(nodeId);
      if (mode === 'create') await db.nodes.delete(nodeId);
      return '';
    }
    await db.nodes.update(nodeId, { content: text ?? '' });
    await recordAiTurn(nodeId, text ?? '');
    // 延迟清理，等 live query 把落库后的行送回组件，避免闪回旧内容
    setTimeout(() => clearAiStreamText(nodeId), cleanupDelayMs);
    return text ?? '';
  } catch (e) {
    writer.cancel();
    clearAiStreamText(nodeId);
    if (mode === 'create') {
      try {
        await db.nodes.delete(nodeId);
      } catch {
        /* node may already be gone */
      }
    }
    throw e;
  }
}
