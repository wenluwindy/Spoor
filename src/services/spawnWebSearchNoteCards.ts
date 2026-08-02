import { db } from '../db';
import type { MetasoWebpage } from './search';
import { hostLabel } from './webPage';

const DEFAULT_STAGGER_MS = 320;
const BASE_DX = 260;
const BASE_DY = 36;
const COL_STEP = 28;
const ROW_STEP = 150;

/**
 * Use the first non-empty line of the draft (cap length) as the Metaso query.
 */
export function deriveSearchQueryFromNoteText(text: string, maxLen = 280): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const line = normalized.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen);
}

function pageToMarkdown(wp: MetasoWebpage, index: number): string {
  const title = (wp.title || 'Source').replace(/\n/g, ' ');
  const snippet = (wp.snippet || '').trim();
  const link = wp.link || '';
  return `### ${index}. ${title}\n\n${snippet}${link ? `\n\n[${link}](${link})` : ''}`;
}

/**
 * 每条搜索结果落一张卡，逐张出现，全部连回源便签。
 *
 * 0.3.x 落的是纯 text 卡，链接只是正文里一段 Markdown——来源的结构化信息
 * （站点、可重抓的地址）在落卡那一刻就丢了。现在带链接的结果直接落 `web` 卡：
 * 标题/摘要立即可读（来自搜索快照，无需再抓一次），地址与站点保留，
 * 「重新抓取」随时能换成完整正文。没有链接的结果仍落 text 卡——没有来源可保。
 */
export async function spawnWebSearchCardsFromPages(
  sourceNodeId: string,
  base: { x: number; y: number },
  pages: MetasoWebpage[],
  activeCanvasId: string,
  options?: { staggerMs?: number },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const list = pages.filter((p) => (p.title || p.snippet || p.link).trim().length > 0);

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const wp = list[i];
    const col = i % 3;
    const row = Math.floor(i / 3);
    const id = crypto.randomUUID();
    const position = {
      x: base.x + BASE_DX + col * COL_STEP,
      y: base.y + BASE_DY + row * ROW_STEP,
    };
    const link = (wp.link || '').trim();
    if (/^https?:\/\//i.test(link)) {
      await db.nodes.add({
        id,
        canvasId: activeCanvasId,
        type: 'web',
        url: link,
        urlTitle: (wp.title || '').replace(/\n/g, ' ').trim() || undefined,
        urlExcerpt: (wp.snippet || '').trim() || undefined,
        urlSiteName: hostLabel(link),
        ...position,
        width: 320,
      });
    } else {
      await db.nodes.add({
        id,
        canvasId: activeCanvasId,
        type: 'text',
        content: pageToMarkdown(wp, i + 1),
        ...position,
        width: 300,
        layout: 2,
      });
    }
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}
