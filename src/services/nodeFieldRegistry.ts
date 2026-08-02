import type { CanvasNode } from '../db';

/**
 * `CanvasNode` 字段的序列化注册表。
 *
 * 背景：0.4.0 期间给节点加 tags/styleOverrides 时，要人肉记得同步 jsonCanvas 的
 * 扩展字段映射——漏一处就是"导出再导入，字段悄悄没了"。0.5.0 又要加第五套
 * 序列化（文件镜像）。这张表把「每个字段在每个通道怎么走」收成一处：
 *
 * - **jsonCanvas / mirror**（镜像格式 = 完整版 JSON Canvas 导出）由本表驱动；
 * - **clipboard / backup** 是整行照抄（结构上天然完整，不需要表）；
 * - **markdown** 是策展式的正文导出，刻意只取 content（不进表）。
 *
 * 映射类型对 `keyof Required<CanvasNode>` 穷举：**给 CanvasNode 加字段而不来
 * 这里表态，tsc 直接报错**——这正是这张表存在的全部意义。
 */
export interface NodeFieldPolicy {
  /**
   * JSON Canvas 通道：
   * - 'native'：由导出器映射到规范原生属性（x/y/width/height、text、file、url、
   *   color、group label），不进 spoor 扩展；
   * - 'spoor'：进节点的 `spoor` 命名空间键，别的工具忽略、导回 Spoor 恢复；
   * - 'skip'：不序列化（归属/派生信息，由文件位置或导入过程重建）。
   */
  jsonCanvas: 'native' | 'spoor' | 'skip';
}

export const CANVAS_NODE_FIELD_POLICIES: { [K in keyof Required<CanvasNode>]: NodeFieldPolicy } = {
  id: { jsonCanvas: 'native' },
  canvasId: { jsonCanvas: 'skip' },       // 归属由文件本身/导入目标决定
  type: { jsonCanvas: 'spoor' },          // ext.type，导回时还原原始类型
  content: { jsonCanvas: 'native' },      // text 节点正文/主题卡拼接，由导出器分支处理
  description: { jsonCanvas: 'spoor' },
  themeTag: { jsonCanvas: 'spoor' },
  agentConfigId: { jsonCanvas: 'spoor' },
  fileType: { jsonCanvas: 'spoor' },
  filePath: { jsonCanvas: 'native' },     // file 节点的 file 属性
  fileName: { jsonCanvas: 'spoor' },
  x: { jsonCanvas: 'native' },
  y: { jsonCanvas: 'native' },
  width: { jsonCanvas: 'native' },
  height: { jsonCanvas: 'native' },
  layout: { jsonCanvas: 'spoor' },
  createdAt: { jsonCanvas: 'spoor' },
  updatedAt: { jsonCanvas: 'spoor' },     // 对账 LWW 的基准，镜像必须带
  tags: { jsonCanvas: 'spoor' },
  styleOverrides: { jsonCanvas: 'spoor' },// bg 另有 native color 映射（导出器处理）
  userTurn: { jsonCanvas: 'spoor' },
  followUpSent: { jsonCanvas: 'spoor' },
  threadRootContextNodeId: { jsonCanvas: 'spoor' },
  threadAgentConfigId: { jsonCanvas: 'spoor' },
  threadContextImageNodeIds: { jsonCanvas: 'spoor' },
  targetCanvasId: { jsonCanvas: 'spoor' },
  url: { jsonCanvas: 'native' },          // link 节点的 url 属性
  urlTitle: { jsonCanvas: 'spoor' },
  urlSiteName: { jsonCanvas: 'spoor' },
  urlExcerpt: { jsonCanvas: 'spoor' },
  urlImage: { jsonCanvas: 'spoor' },
  urlFetchedAt: { jsonCanvas: 'spoor' },
  urlError: { jsonCanvas: 'spoor' },
  pdfPage: { jsonCanvas: 'spoor' },
  pdfPageCount: { jsonCanvas: 'spoor' },
  imageGenProviderId: { jsonCanvas: 'spoor' },
  imageGenModelId: { jsonCanvas: 'spoor' },
  imageGenPrompt: { jsonCanvas: 'spoor' },
  imageGenIgnoreUpstreamText: { jsonCanvas: 'spoor' },
  imageGenParams: { jsonCanvas: 'spoor' },
  imageGenResults: { jsonCanvas: 'spoor' },
  imageGenActiveIndex: { jsonCanvas: 'spoor' },
  imageGenExcludedRefIds: { jsonCanvas: 'spoor' },
  imageGenErrorCode: { jsonCanvas: 'spoor' },
  imageGenErrorDetail: { jsonCanvas: 'spoor' },
  imageGenMeta: { jsonCanvas: 'spoor' },
};

const SPOOR_KEYS = (Object.keys(CANVAS_NODE_FIELD_POLICIES) as (keyof CanvasNode)[]).filter(
  (k) => CANVAS_NODE_FIELD_POLICIES[k].jsonCanvas === 'spoor',
);

/**
 * 该不该把这个值写进扩展字段。语义沿用 0.4.x 的手写规则：
 * 空串/空数组/全空对象/false 都是"没写过"，不值得占一行；
 * 数字 0 是有效值（layout 0、activeIndex 0），必须保留。
 */
function isWorthKeeping(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((v) => v != null);
  return true; // number
}

/** 导出侧：按注册表收集要进 `spoor` 命名空间的字段。 */
export function collectSpoorExtension(node: CanvasNode): Record<string, unknown> {
  const ext: Record<string, unknown> = {};
  for (const key of SPOOR_KEYS) {
    const value = node[key];
    if (isWorthKeeping(value)) ext[key] = value;
  }
  return ext;
}

/** 导入侧：从扩展字段里只捡注册过的键（陌生键丢弃——未来版本的字段不硬塞进旧行）。 */
export function pickSpoorExtension(ext: Record<string, unknown> | undefined): Partial<CanvasNode> {
  if (!ext) return {};
  const picked: Record<string, unknown> = {};
  for (const key of SPOOR_KEYS) {
    const value = ext[key];
    if (value !== undefined && value !== null) picked[key] = value;
  }
  return picked as Partial<CanvasNode>;
}
