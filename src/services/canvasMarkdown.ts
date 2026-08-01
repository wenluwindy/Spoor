/**
 * 把一张画布摊平成一篇 Markdown。
 *
 * 用途是「把内容带去别处」——发给不用 Spoor 的人、贴进博客、丢给另一个工具接着写。
 * 因此这里追求的是**读起来像一篇东西**，而不是无损还原画布：空间关系没法用 Markdown
 * 表达，硬编成一堆坐标只会让人读不下去。要无损请用 `.canvas`（见 `jsonCanvas`）。
 *
 * 两个决定：
 *
 * - **顺序按位置从上到下、同一行从左到右**。人在画布上铺想法时本来就大致遵循这个次序，
 *   按创建时间排反而会把后来补写的卡片甩到末尾。同一「行」的判定留了容差，
 *   否则两张肉眼齐平、y 差 3px 的卡片会被排成上下两段。
 * - **连线单列一节附在末尾**。挨着每张卡片写"连到 X"会把正文切得七零八落，
 *   而连线本身又确实是内容的一部分，不能丢。
 */

import type { CanvasNode, Edge } from '../db';

/** y 相差不超过这个值算同一行。约等于一张卡片的半个身位。 */
export const ROW_TOLERANCE_PX = 80;

/** 媒体在导出目录里的子目录名。 */
export const ASSETS_DIR = 'assets';

export interface MarkdownExportOptions {
  canvasName: string;
  exportedAt: Date;
  /** Agent 卡没有正文，名字要从人设表里查。 */
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
  /** 媒体相对路径 → 导出目录内的文件名。没给就不写图片链接。 */
  assetNameByPath?: Map<string, string>;
}

/** 阅读顺序：先按行分组（y 容差内算同一行），行内按 x 从左到右。 */
export function sortNodesForReading(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => {
    if (Math.abs(a.y - b.y) > ROW_TOLERANCE_PX) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
}

/** 卡片在附录里的称呼：优先用正文第一行，太长就截断。 */
export function nodeLabel(node: CanvasNode, index: number, agentName?: string): string {
  const raw = (node.content ?? node.fileName ?? agentName ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return `#${index + 1}`;
  const short = raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
  return `#${index + 1} ${short}`;
}

function mediaLink(
  node: CanvasNode,
  rel: string | undefined,
  assetNameByPath: Map<string, string> | undefined,
): string | null {
  if (!rel) return null;
  const name = assetNameByPath?.get(rel);
  if (!name) return null;
  const alt = node.fileName ?? name;
  return `![${alt}](${ASSETS_DIR}/${name})`;
}

function renderNode(node: CanvasNode, options: MarkdownExportOptions): string {
  const { assetNameByPath } = options;

  switch (node.type) {
    case 'theme': {
      const parts = [`## ${node.content?.trim() || ''}`.trim()];
      if (node.description?.trim()) parts.push(node.description.trim());
      if (node.themeTag?.trim()) parts.push(`*${node.themeTag.trim()}*`);
      return parts.join('\n\n');
    }
    case 'ai': {
      const question = node.userTurn?.trim();
      const quoted = question
        ? `${question
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')}\n\n`
        : '';
      return `${quoted}${node.content ?? ''}`;
    }
    case 'agent': {
      const name = options.agentNameById?.(node.agentConfigId) ?? node.agentConfigId ?? '';
      return `**${name}**`;
    }
    case 'image':
      return mediaLink(node, node.filePath, assetNameByPath) ?? `*${node.fileName ?? ''}*`;
    case 'video':
      return node.fileName ? `🎬 ${node.fileName}` : '';
    case 'document': {
      const title = node.fileName ? `**${node.fileName}**` : '';
      // 文档正文在库里是 docx 转出的 HTML，直接贴进 Markdown 会是一堆标签
      const body = node.fileType === 'docx' ? '' : (node.content ?? '');
      return [title, body].filter(Boolean).join('\n\n');
    }
    case 'imagegen': {
      const active = node.imageGenResults?.[node.imageGenActiveIndex ?? 0];
      const image = mediaLink(node, active, assetNameByPath);
      const prompt = node.imageGenPrompt?.trim();
      return [image, prompt ? `*${prompt}*` : ''].filter(Boolean).join('\n\n');
    }
    default:
      return node.content ?? '';
  }
}

export function canvasToMarkdown(
  nodes: CanvasNode[],
  edges: Edge[],
  options: MarkdownExportOptions,
): string {
  const ordered = sortNodesForReading(nodes);
  const labelById = new Map<string, string>();
  ordered.forEach((node, index) => {
    labelById.set(
      node.id,
      nodeLabel(node, index, options.agentNameById?.(node.agentConfigId)),
    );
  });

  const head = [
    `# ${options.canvasName}`,
    `*${options.exportedAt.toLocaleString()} · ${nodes.length} nodes*`,
  ].join('\n\n');

  const body = ordered
    .map((node) => renderNode(node, options).trim())
    .filter((section) => section !== '')
    .join('\n\n---\n\n');

  const linked = edges.filter((e) => labelById.has(e.from) && labelById.has(e.to));
  const appendix =
    linked.length === 0
      ? ''
      : ['## ⇢', ...linked.map((e) => `- ${labelById.get(e.from)} → ${labelById.get(e.to)}`)].join(
          '\n',
        );

  return [head, body, appendix].filter(Boolean).join('\n\n') + '\n';
}

/**
 * 给每个媒体相对路径分配导出目录里的文件名。
 *
 * 不同目录下的同名文件（两个 `a.png`）会撞车，撞到就在名字后面补序号——
 * 让第二张图静默覆盖第一张是最坏的结果。
 */
export function allocateAssetNames(relPaths: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();

  for (const rel of relPaths) {
    const base = rel.split('/').pop() || 'file';
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';

    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      name = `${stem}-${n}${ext}`;
      n += 1;
    }
    used.add(name.toLowerCase());
    out.set(rel, name);
  }

  return out;
}
