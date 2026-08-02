/**
 * 对齐与分布的纯计算。输入是选中节点的几何快照（高度从 DOM 现量，
 * 库里的 height 常为空——卡片高度大多自适应内容），输出是每个节点的新坐标，
 * 由调用方走可撤销写入落库。
 */

export interface AlignableNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

export interface NodePositionPatch {
  id: string;
  x: number;
  y: number;
}

/** 对齐到选区自身的包围盒（不是视口）：这是所有白板的通用语义。 */
export function alignNodes(nodes: AlignableNode[], mode: AlignMode): NodePositionPatch[] {
  if (nodes.length < 2) return [];
  const left = Math.min(...nodes.map((n) => n.x));
  const right = Math.max(...nodes.map((n) => n.x + n.width));
  const top = Math.min(...nodes.map((n) => n.y));
  const bottom = Math.max(...nodes.map((n) => n.y + n.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  return nodes
    .map((n) => {
      switch (mode) {
        case 'left':
          return { id: n.id, x: left, y: n.y };
        case 'right':
          return { id: n.id, x: right - n.width, y: n.y };
        case 'center-h':
          return { id: n.id, x: centerX - n.width / 2, y: n.y };
        case 'top':
          return { id: n.id, x: n.x, y: top };
        case 'bottom':
          return { id: n.id, x: n.x, y: bottom - n.height };
        case 'center-v':
          return { id: n.id, x: n.x, y: centerY - n.height / 2 };
      }
    })
    .filter((p) => {
      const source = nodes.find((n) => n.id === p.id)!;
      return p.x !== source.x || p.y !== source.y;
    });
}

/**
 * 等间距分布：首尾两张不动，中间的把**间隙**均分。
 * 均分的是间隙而不是中心距——卡片宽高不一时，均分中心会让窄卡两侧的空隙看起来不等。
 */
export function distributeNodes(nodes: AlignableNode[], axis: DistributeAxis): NodePositionPatch[] {
  if (nodes.length < 3) return [];
  const sizeOf = (n: AlignableNode) => (axis === 'horizontal' ? n.width : n.height);
  const posOf = (n: AlignableNode) => (axis === 'horizontal' ? n.x : n.y);

  const sorted = [...nodes].sort((a, b) => posOf(a) - posOf(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = posOf(last) + sizeOf(last) - posOf(first);
  const totalSize = sorted.reduce((sum, n) => sum + sizeOf(n), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  const patches: NodePositionPatch[] = [];
  let cursor = posOf(first) + sizeOf(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const n = sorted[i];
    const next = axis === 'horizontal' ? { id: n.id, x: cursor, y: n.y } : { id: n.id, x: n.x, y: cursor };
    if (next.x !== n.x || next.y !== n.y) patches.push(next);
    cursor += sizeOf(n) + gap;
  }
  return patches;
}
