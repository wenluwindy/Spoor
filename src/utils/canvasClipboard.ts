import type { CanvasNode, Edge } from '../db';
import { parseStickyClipboardPayload } from './noteClipboard';

/**
 * 画布剪贴板负载（v2）。
 *
 * 与 v1（`noteClipboard`，只装便签）的两处区别，也是这次扩展的全部动机：
 *
 * 1. **不挑类型**。图片、文档、生图、Agent 卡都能复制，字段整行照抄。媒体节点复制的是
 *    `filePath` 这个相对路径，两张卡指向同一个原件——不复制文件本身，也就不会因为
 *    复制一张 500MB 的视频卡把磁盘占两份。
 * 2. **带连线**。只带**两端都在选区内**的边：一头连着没被复制的卡片的边，粘出来无处可接。
 *
 * 负载里的 `sourceId` 只为把边重新映射到副本上，永远不会被写进库。
 */

export const CANVAS_CLIPBOARD_KIND = 'spoor-canvas-v2' as const;

/** 复制出来的行：除 id 与画布归属外整行照抄。 */
export type CanvasClipboardNodeData = Omit<CanvasNode, 'id' | 'canvasId'>;

export interface CanvasClipboardNode {
  sourceId: string;
  node: CanvasClipboardNodeData;
}

export interface CanvasClipboardPayloadV2 {
  kind: typeof CANVAS_CLIPBOARD_KIND;
  nodes: CanvasClipboardNode[];
  edges: { from: string; to: string }[];
}

/** 粘贴时相对原位置的偏移，让副本不完全盖住原件。 */
export const CANVAS_PASTE_OFFSET = 24;

export function buildCanvasClipboardPayload(
  nodes: CanvasNode[],
  edges: Edge[],
): CanvasClipboardPayloadV2 | null {
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((n) => n.id));

  return {
    kind: CANVAS_CLIPBOARD_KIND,
    nodes: nodes.map((row) => {
      const { id, canvasId: _canvasId, ...rest } = row;
      return { sourceId: id, node: rest };
    }),
    edges: edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ from: e.from, to: e.to })),
  };
}

function parseV2(raw: unknown): CanvasClipboardPayloadV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (rec.kind !== CANVAS_CLIPBOARD_KIND || !Array.isArray(rec.nodes)) return null;

  const nodes: CanvasClipboardNode[] = [];
  for (const item of rec.nodes) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const sourceId = entry.sourceId;
    const node = entry.node;
    if (typeof sourceId !== 'string' || !node || typeof node !== 'object') return null;

    const data = node as Record<string, unknown>;
    if (typeof data.type !== 'string') return null;
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    // 落库前把 id / canvasId 摘掉：粘贴出来的是新行，归属由目标画布决定
    const { id: _id, canvasId: _canvasId, ...rest } = data;
    nodes.push({ sourceId, node: { ...rest, type: data.type, x, y } as CanvasClipboardNodeData });
  }
  if (nodes.length === 0) return null;

  const known = new Set(nodes.map((n) => n.sourceId));
  const edges: { from: string; to: string }[] = [];
  for (const item of Array.isArray(rec.edges) ? rec.edges : []) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    if (!known.has(e.from) || !known.has(e.to)) continue;
    edges.push({ from: e.from, to: e.to });
  }

  return { kind: CANVAS_CLIPBOARD_KIND, nodes, edges };
}

/**
 * 解析剪贴板文本。
 *
 * 也认 v1 的便签负载——旧版本复制的内容还躺在系统剪贴板里，升级后第一次粘贴
 * 不该报个「格式不对」。
 */
export function parseCanvasClipboardPayload(raw: string): CanvasClipboardPayloadV2 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const v2 = parseV2(parsed);
  if (v2) return v2;

  const v1 = parseStickyClipboardPayload(raw);
  if (!v1) return null;
  return {
    kind: CANVAS_CLIPBOARD_KIND,
    nodes: v1.nodes.map((n, index) => ({
      sourceId: `v1-${index}`,
      node: {
        type: n.type,
        content: n.content ?? '',
        layout: n.layout,
        width: n.width,
        height: n.height,
        x: n.x,
        y: n.y,
      },
    })),
    edges: [],
  };
}

export interface MaterializedClipboard {
  nodes: CanvasNode[];
  edges: Edge[];
}

/**
 * 把负载变成可以落库的行。
 *
 * `at` 给了就把整批的左上角放到那儿（右键「粘贴」用点击点）；没给就原地偏移一点
 * （Ctrl+V 用，跟着原位置走才知道粘到哪去了）。多张之间的相对位置一律保持不变。
 */
export function materializeCanvasClipboard(
  payload: CanvasClipboardPayloadV2,
  canvasId: string,
  at?: { x: number; y: number },
): MaterializedClipboard {
  const baseX = Math.min(...payload.nodes.map((n) => n.node.x));
  const baseY = Math.min(...payload.nodes.map((n) => n.node.y));

  const idBySource = new Map<string, string>();
  const nodes: CanvasNode[] = payload.nodes.map((entry) => {
    const id = crypto.randomUUID();
    idBySource.set(entry.sourceId, id);
    const offset = at
      ? { x: at.x + (entry.node.x - baseX), y: at.y + (entry.node.y - baseY) }
      : { x: entry.node.x + CANVAS_PASTE_OFFSET, y: entry.node.y + CANVAS_PASTE_OFFSET };
    return { ...entry.node, id, canvasId, x: offset.x, y: offset.y };
  });

  const edges: Edge[] = [];
  for (const e of payload.edges) {
    const from = idBySource.get(e.from);
    const to = idBySource.get(e.to);
    if (!from || !to) continue;
    edges.push({ id: crypto.randomUUID(), canvasId, from, to });
  }

  return { nodes, edges };
}
