/**
 * 网页卡片：抓回一个地址，提取出标题、站点名、封面与正文摘要。
 *
 * 抓取在 Rust（`src-tauri/src/webpage.rs`，绕开 CORS），**提取在这里**——浏览器
 * 自带的 `DOMParser` 比在 Rust 里再引一套 HTML 解析库好用得多，而且解析出来的东西
 * 本来就要在前端渲染。
 *
 * 正文提取是**启发式**的，不是 Readability 那种完整实现：找出正文块最多的那个容器，
 * 去掉导航、脚本、样式，取前若干字。做不到对所有站点都准，但对"这张卡片讲的是什么"
 * 这个问题够用了，而且没有引入一个几十 KB 的依赖。
 */

import { isTauriRuntime } from '../utils/isTauriRuntime';
import { AppError } from './appError';

export interface WebPageMeta {
  url: string;
  title: string;
  siteName: string;
  excerpt: string;
  /** 封面图的远程地址（可能为空）。 */
  image: string;
}

/** 摘要保留多少字。够看出主题，又不至于把整张卡片撑爆。 */
export const EXCERPT_LENGTH = 400;

/** 这些标签里的文字不是正文。 */
const NON_CONTENT_TAGS = 'script,style,noscript,nav,header,footer,aside,form,iframe,svg,template';

/** 粘贴进来的文本是不是一个可抓取的地址。 */
export function isFetchableUrl(raw: string): boolean {
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text)) return false;
  // 一整段文字里恰好含链接不算——粘贴一篇文章不该变成一张网页卡
  if (/\s/.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** `https://www.example.com/a/b` → `example.com`。 */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function metaContent(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return '';
}

/** 相对地址补成绝对地址；补不出来就当没有。 */
export function absoluteUrl(candidate: string, base: string): string {
  if (!candidate) return '';
  try {
    return new URL(candidate, base).toString();
  } catch {
    return '';
  }
}

/**
 * 找出最像正文的那个容器：按「后代文本总长」取胜者。
 *
 * 比"取 `<article>`"更耐操——很多站点根本不用语义标签，而堆砌导航的容器
 * 文本量通常远小于正文。
 */
function pickContentRoot(doc: Document): Element {
  const candidates = [...doc.querySelectorAll('article, main, [role="main"], section, div')];
  let best: Element = doc.body ?? doc.documentElement;
  let bestLength = (best.textContent ?? '').length;

  for (const el of candidates) {
    // 太深的容器往往是单个段落；这里只比总量，简单但有效
    const length = (el.textContent ?? '').length;
    if (length > bestLength) {
      best = el;
      bestLength = length;
    }
  }
  return best;
}

export function extractWebPageMeta(html: string, finalUrl: string): WebPageMeta {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(NON_CONTENT_TAGS).forEach((el) => el.remove());

  const title =
    metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    doc.querySelector('title')?.textContent?.trim() ||
    hostLabel(finalUrl);

  const siteName =
    metaContent(doc, ['meta[property="og:site_name"]']) || hostLabel(finalUrl);

  const description = metaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ]);

  const bodyText = (pickContentRoot(doc).textContent ?? '').replace(/\s+/g, ' ').trim();
  // 站点自己写的 description 通常比启发式抽出来的正文更准，优先用它
  const excerpt = (description || bodyText).slice(0, EXCERPT_LENGTH);

  const image = absoluteUrl(
    metaContent(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]']),
    finalUrl,
  );

  return { url: finalUrl, title, siteName, excerpt, image };
}

interface WebPageFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
}

/**
 * 抓一个网页并提取元信息。
 *
 * @throws AppError `web.desktop_only` / `web.fetch_failed`
 */
export async function fetchWebPageMeta(url: string): Promise<WebPageMeta> {
  if (!isTauriRuntime()) {
    // 浏览器里发不出跨域请求，这条路只存在于 `npm run dev` 调试
    throw new AppError('web.desktop_only', url);
  }

  const { invoke } = await import('@tauri-apps/api/core');
  let result: WebPageFetchResult;
  try {
    result = await invoke<WebPageFetchResult>('fetch_webpage', { url });
  } catch (e) {
    throw new AppError('web.fetch_failed', String(e));
  }

  return extractWebPageMeta(result.html, result.finalUrl || url);
}
