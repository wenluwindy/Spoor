const LOG_PREFIX = '[Scribe AI][Search]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetasoSearchConfig {
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
    throw new Error('Metaso API key is empty');
  }

  console.info(`${LOG_PREFIX} metasoSearch`, { query });

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
      console.error(`${LOG_PREFIX} Tauri metaso_search failed`, e);
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
      console.error(`${LOG_PREFIX} HTTP ${response.status}`, text.slice(0, 500));
      throw new Error(`Metaso search HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as MetasoSearchResponse;
  } finally {
    clearTimeout(timer);
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
