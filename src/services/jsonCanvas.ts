/**
 * JSON Canvas（[jsoncanvas.org](https://jsoncanvas.org/spec/1.0/)）互转。
 *
 * 这是 Obsidian 牵头的开放格式，MIT。对一个「本地优先、不内置 Key」的产品来说，
 * 能被别的工具原样打开比多一个功能重要得多——数据出不去的本地优先只是句口号。
 *
 * ## 映射
 *
 * | Spoor | JSON Canvas | 说明 |
 * |---|---|---|
 * | note / text / ai | `text` | 正文原样写进 `text` |
 * | theme | `text` | 标题、说明、页脚拼成一段 Markdown |
 * | agent | `text` | 卡片本身没有正文，写人设名 |
 * | image / video / document | `file` | 写**相对路径**，和 `CanvasNode.filePath` 一致 |
 * | imagegen | `file`（当前那张结果）或 `text`（还没出图时写提示词） | |
 *
 * 连线固定 `fromSide: 'right'` / `toSide: 'left'` / `toEnd: 'arrow'`，与 Spoor 卡片
 * 左进右出的固定端口一致（见 `utils/edgePath`）。
 *
 * ## 无损往返
 *
 * 规范 1.0 刻意保守，装不下 Spoor 的语义（版式、Agent 绑定、生图参数…）。这些放在
 * 节点对象的 `spoor` 命名空间键下：别的工具会忽略它，导回 Spoor 时则据此还原原始类型。
 * 规范没有禁止扩展键，但也没有承诺保留——所以导出到 Obsidian 编辑后再导回来，
 * 拿到的可能是降级后的文本卡。这是格式的边界，不是 bug。
 *
 * ## 导入时的降级
 *
 * `link`（Spoor 还没有 URL 节点）与 `group`（还没有 Frame）在这一版没有对应物，
 * 分别降级成文本卡与主题卡，并在结果里报数——静默丢掉才是最糟的做法。
 */

import type { CanvasNode, Edge } from '../db';
import { collectSpoorExtension, pickSpoorExtension } from './nodeFieldRegistry';

export const JSON_CANVAS_FILE_EXTENSION = 'canvas';

export type JsonCanvasNodeType = 'text' | 'file' | 'link' | 'group';

export interface JsonCanvasNode {
  id: string;
  type: JsonCanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  /** type === 'text' */
  text?: string;
  /** type === 'file' */
  file?: string;
  /** type === 'link' */
  url?: string;
  /** type === 'group' */
  label?: string;
  /** Spoor 专有字段，别的工具应当忽略。 */
  spoor?: SpoorNodeExtension;
}

/**
 * `spoor` 命名空间的形状由 `nodeFieldRegistry` 决定（policy === 'spoor' 的全部字段）。
 * 0.5.0 起不再手写字段清单——手写清单在 0.4.x 造成过导出即丢
 * （followUpSent、追问链 id、生图参数、PDF 页码都曾不随导出走）。
 */
export type SpoorNodeExtension = { type: string } & Record<string, unknown>;

export interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  toEnd?: 'none' | 'arrow';
  label?: string;
}

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

/** 规范要求每个节点都有宽高；Spoor 的卡片高度常常是自适应（库里为空）。 */
const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 200;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const at = name.lastIndexOf('.');
  return at > 0 ? name.slice(at + 1).toLowerCase() : '';
}

/** 主题卡的三段文字拼成一段 Markdown，在别的工具里读起来才像回事。 */
export function themeNodeToMarkdown(node: CanvasNode): string {
  const parts: string[] = [];
  if (node.content?.trim()) parts.push(`# ${node.content.trim()}`);
  if (node.description?.trim()) parts.push(node.description.trim());
  if (node.themeTag?.trim()) parts.push(`— ${node.themeTag.trim()}`);
  return parts.join('\n\n');
}

/** AI 卡：把这一轮的追问写成引用块放在回复上方，脱离 Spoor 也能看懂上下文。 */
export function aiNodeToMarkdown(node: CanvasNode): string {
  const answer = node.content ?? '';
  const question = node.userTurn?.trim();
  if (!question) return answer;
  const quoted = question
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n${answer}`;
}

function buildExtension(node: CanvasNode): SpoorNodeExtension {
  const ext: SpoorNodeExtension = { ...collectSpoorExtension(node), type: node.type };
  // ai/theme 卡的原生 text 是**派生投影**（追问引用块 / 三段拼接），不是原始 content。
  // 原始值进扩展字段，导回/镜像对账才不会把投影当正文写回去。
  if ((node.type === 'ai' || node.type === 'theme') && node.content) {
    ext.content = node.content;
  }
  return ext;
}

export interface ExportOptions {
  /** Agent 卡没有正文，名字得从人设表里查。 */
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
}

export function nodeToJsonCanvas(node: CanvasNode, options: ExportOptions = {}): JsonCanvasNode {
  const base = {
    id: node.id,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width || DEFAULT_NODE_WIDTH),
    height: Math.round(node.height || DEFAULT_NODE_HEIGHT),
    // 背景色映射到规范原生的 color：Obsidian 里也能看到这张卡是"黄的"
    ...(node.styleOverrides?.bg ? { color: node.styleOverrides.bg } : {}),
    spoor: buildExtension(node),
  };

  // 网页卡片正好对上规范原生的 link 节点
  if (node.type === 'web' && node.url) {
    return { ...base, type: 'link', url: node.url };
  }

  // 区域框正好对上规范原生的 group 节点
  if (node.type === 'frame') {
    return { ...base, type: 'group', label: node.content ?? '' };
  }

  if (node.type === 'image' || node.type === 'video' || node.type === 'document') {
    // 没有 filePath 的老节点（正文还在 content 里）退回文本卡，总比导出一个空 file 好
    if (node.filePath) return { ...base, type: 'file', file: node.filePath };
    return { ...base, type: 'text', text: node.content ?? node.fileName ?? '' };
  }

  if (node.type === 'imagegen') {
    const active = node.imageGenResults?.[node.imageGenActiveIndex ?? 0];
    if (active) return { ...base, type: 'file', file: active };
    return { ...base, type: 'text', text: node.imageGenPrompt ?? '' };
  }

  if (node.type === 'theme') {
    return { ...base, type: 'text', text: themeNodeToMarkdown(node) };
  }

  if (node.type === 'ai') {
    return { ...base, type: 'text', text: aiNodeToMarkdown(node) };
  }

  if (node.type === 'agent') {
    const name = options.agentNameById?.(node.agentConfigId) ?? node.agentConfigId ?? '';
    return { ...base, type: 'text', text: name };
  }

  return { ...base, type: 'text', text: node.content ?? '' };
}

export function edgeToJsonCanvas(edge: Edge): JsonCanvasEdge {
  return {
    id: edge.id,
    fromNode: edge.from,
    toNode: edge.to,
    // Spoor 的端口固定在卡片左右两侧中点，方向也就固定了
    fromSide: 'right',
    toSide: 'left',
    toEnd: 'arrow',
  };
}

export function exportCanvasToJsonCanvas(
  nodes: CanvasNode[],
  edges: Edge[],
  options: ExportOptions = {},
): JsonCanvasDocument {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => nodeToJsonCanvas(n, options)),
    // 端点缺一个的边在别的工具里会被当成坏数据，导出前先摘掉
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map(edgeToJsonCanvas),
  };
}

export function serializeJsonCanvas(doc: JsonCanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ── 导入 ──

export interface ImportDegradations {
  /** 历史遗留：0.3.1 起 `link` 直接落成网页卡片，不再降级，恒为 0。 */
  links: number;
  /** 历史遗留：0.3.1 起 `group` 直接落成区域框，不再降级，恒为 0。 */
  groups: number;
  /** 类型不认识、或必填字段缺失，整条跳过。 */
  skipped: number;
}

export interface ImportResult {
  nodes: CanvasNode[];
  edges: Edge[];
  degraded: ImportDegradations;
}

function fileNodeType(path: string): 'image' | 'video' | 'document' {
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'document';
}

function readExtension(raw: unknown): SpoorNodeExtension | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.type !== 'string') return undefined;
  return rec as unknown as SpoorNodeExtension;
}

/** 解析文本。不是合法 JSON 或缺少 `nodes` 数组时返回 null。 */
export function parseJsonCanvas(raw: string): JsonCanvasDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.nodes)) return null;
  return {
    nodes: rec.nodes as JsonCanvasNode[],
    edges: Array.isArray(rec.edges) ? (rec.edges as JsonCanvasEdge[]) : [],
  };
}

/**
 * 变成可以落库的 Spoor 行。
 *
 * id 一律新发：导进来的是**副本**，与源文件里的 id 撞车会覆盖掉画布上已有的卡片。
 * 边跟着重映射，指向不存在节点的边直接丢掉。
 */
export function importJsonCanvas(
  doc: JsonCanvasDocument,
  canvasId: string,
  newId: () => string = () => crypto.randomUUID(),
): ImportResult {
  const degraded: ImportDegradations = { links: 0, groups: 0, skipped: 0 };
  const idBySource = new Map<string, string>();
  const nodes: CanvasNode[] = [];

  for (const raw of doc.nodes) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
      degraded.skipped += 1;
      continue;
    }
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      degraded.skipped += 1;
      continue;
    }

    const id = newId();
    const ext = readExtension(raw.spoor);
    // 注册表捡回全部 spoor 字段（0.5.0 起完整往返：追问链、生图参数、PDF 页码都不丢），
    // 再叠加规范原生属性与分支特有的覆盖
    const common = {
      ...pickSpoorExtension(ext),
      id,
      canvasId,
      x,
      y,
      width: Number.isFinite(raw.width) ? Number(raw.width) : undefined,
      height: Number.isFinite(raw.height) ? Number(raw.height) : undefined,
      // 扩展字段优先；没有时把规范的 color（仅认 hex，"1"-"6" 预设无从对应）当背景色
      styleOverrides:
        ext?.styleOverrides as CanvasNode['styleOverrides'] ??
        (typeof raw.color === 'string' && raw.color.startsWith('#')
          ? { bg: raw.color }
          : undefined),
    };

    let row: CanvasNode | null = null;

    if (raw.type === 'file' && typeof raw.file === 'string') {
      row = {
        ...common,
        // 扩展字段里的原始类型优先：imagegen 导出的是当前结果图，导回来该还是图片卡
        type: ext?.type === 'imagegen' ? 'image' : (ext?.type ?? fileNodeType(raw.file)),
        filePath: raw.file,
        fileName: (ext?.fileName as string | undefined) ?? raw.file.split('/').pop(),
      };
    } else if (raw.type === 'text' && typeof raw.text === 'string') {
      row = {
        ...common,
        type: ext?.type ?? 'text',
        // 扩展里带了原始 content（ai/theme 的派生投影场景）就用它，别把投影当正文
        content: typeof ext?.content === 'string' ? ext.content : raw.text,
      };
    } else if (raw.type === 'link' && typeof raw.url === 'string') {
      // 0.3.1 起有网页卡片：link 原样落成 web 节点，抓取缓存从扩展字段带回
      row = {
        ...common,
        type: 'web',
        url: raw.url,
      };
    } else if (raw.type === 'group') {
      // 0.3.1 起有区域框：group 原样落成 frame
      row = { ...common, type: 'frame', content: raw.label ?? '' };
    }

    if (!row) {
      degraded.skipped += 1;
      continue;
    }

    idBySource.set(raw.id, id);
    nodes.push(row);
  }

  const edges: Edge[] = [];
  for (const raw of doc.edges) {
    if (!raw || typeof raw !== 'object') continue;
    const from = idBySource.get(raw.fromNode);
    const to = idBySource.get(raw.toNode);
    if (!from || !to) continue;
    edges.push({ id: newId(), canvasId, from, to });
  }

  return { nodes, edges, degraded };
}
