import { AppError } from './appError';
import type { SearchProviderKind } from '../types/aiConfig';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetasoSearchConfig {
  apiKey: string;
}

export interface WebSearchConfig {
  kind: SearchProviderKind;
  apiKey: string;
}

export interface MetasoWebpage {
  title: string;
  link: string;
  snippet: string;
  score: string;
  date: string;
}

export interface MetasoSearchResponse {
  credits: number;
  total: number;
  webpages: MetasoWebpage[];
}

/**
 * 各家搜索服务归一后的形状。
 *
 * 沿用秘塔的字段名而不是另起一套：`buildSearchContext` 与两个调用方的下游
 * 全都吃这个结构，换名字等于把改动摊到整条链路上，收益只是好看一点。
 */
export type WebSearchResponse = MetasoSearchResponse;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
  );
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------

const METASO_ENDPOINT = 'https://metaso.cn/api/v1/search';
const SEARCH_TIMEOUT_MS = 15_000;

/**
 * Call the Metaso (秘塔) web search API.
 *
 * - **Tauri desktop**: uses a Rust-side HTTP command to avoid CORS.
 * - **Browser dev/preview**: uses the Vite `/api/metaso` proxy.
 */
export async function metasoSearch(
  query: string,
  config: MetasoSearchConfig,
): Promise<MetasoSearchResponse> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new AppError('search.no_key');
  }

  logger.info('search', 'metasoSearch', { query });

  // ---- Tauri path --------------------------------------------------------
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const json = await invoke<string>('metaso_search', {
        apiKey,
        query,
      });
      return JSON.parse(json) as MetasoSearchResponse;
    } catch (e) {
      logger.error('search', 'Tauri metaso_search failed', e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // ---- Browser path (Vite proxy) -----------------------------------------
  const proxyUrl = `/api/metaso/api/v1/search`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        q: query,
        scope: 'webpage',
        size: 5,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('search', `HTTP ${response.status}`, text.slice(0, 500));
      throw new AppError('search.failed', `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as MetasoSearchResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

/**
 * Tavily 的 `results[]` → 归一后的 `webpages[]`。
 *
 * `content` 就是给模型看的那段摘要，直接当 snippet。`published_date` 只有
 * `topic: news` 才会有，一般是空的。
 */
export function mapTavilyResults(raw: unknown): WebSearchResponse {
  const results = (raw as { results?: TavilyResult[] } | null)?.results ?? [];
  const webpages = results.map((r) => ({
    title: String(r.title ?? ''),
    link: String(r.url ?? ''),
    snippet: String(r.content ?? ''),
    score: r.score === undefined ? '' : String(r.score),
    date: String(r.published_date ?? ''),
  }));
  return { credits: 0, total: webpages.length, webpages };
}

async function tavilySearch(query: string, apiKey: string): Promise<WebSearchResponse> {
  logger.info('search', 'tavilySearch', { query });

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const json = await invoke<string>('tavily_search', { apiKey, query });
      return mapTavilyResults(JSON.parse(json));
    } catch (e) {
      logger.error('search', 'Tauri tavily_search failed', e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // 浏览器路径：Tavily 是带 CORS 的，不用像秘塔那样走 Vite 代理
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('search', `HTTP ${response.status}`, text.slice(0, 500));
      throw new AppError('search.failed', `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return mapTavilyResults(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * 按当前启用的服务跑一次联网搜索。
 *
 * 各家返回结构在各自的适配里归一成同一个形状，所以调用方只管拿 `webpages`。
 */
export async function webSearch(
  query: string,
  config: WebSearchConfig,
): Promise<WebSearchResponse> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new AppError('search.no_key');
  }

  switch (config.kind) {
    case 'tavily':
      return tavilySearch(query, apiKey);
    case 'metaso':
    default:
      return metasoSearch(query, { apiKey });
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Turn raw search results into a text block that can be injected into an LLM
 * prompt as supplementary context.
 */
export function buildSearchContext(results: MetasoSearchResponse): string {
  const webpages = results.webpages ?? [];
  if (webpages.length === 0) return '';

  const fragments = webpages.map((wp, idx) => {
    return `[Source ${idx + 1}: ${wp.title}](${wp.link})\n${wp.snippet}`;
  });

  return [
    '--- Web search results ---',
    fragments.join('\n\n'),
    '--- End of search results ---',
  ].join('\n');
}
