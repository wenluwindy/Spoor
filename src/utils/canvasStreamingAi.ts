import { db } from '../db';
import { createThrottle } from './aiStreamThrottle';

export const DEFAULT_STREAM_THROTTLE_MS = 100;

export function createStreamChunkWriter(
  nodeId: string,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
): {
  onStreamChunk: (accumulated: string) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  const throttle = createThrottle((content: string) => {
    void db.nodes.update(nodeId, { content });
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
};

/** Runs AI with streaming Dexie updates; returns final text (empty if model returned blank). */
export async function runCanvasStreamingAiCall({
  nodeId,
  callAi,
  throttleMs = DEFAULT_STREAM_THROTTLE_MS,
}: CanvasStreamingAiCallParams): Promise<string> {
  const writer = createStreamChunkWriter(nodeId, throttleMs);
  try {
    const text = await callAi(writer.onStreamChunk);
    await writer.flush();
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      writer.cancel();
      await db.nodes.delete(nodeId);
      return '';
    }
    await db.nodes.update(nodeId, { content: text ?? '' });
    return text ?? '';
  } catch (e) {
    writer.cancel();
    try {
      await db.nodes.delete(nodeId);
    } catch {
      /* node may already be gone */
    }
    throw e;
  }
}
