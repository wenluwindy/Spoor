import { parseLenientLlmJson } from './llmJson';

export interface ParsedPublishArticle {
  title: string;
  body: string;
}

/** 从合成长文模型输出解析标题与 Markdown 正文；失败时回退为整段正文 + 默认标题 */
export function parsePublishArticleResponse(raw: string, fallbackTitle: string): ParsedPublishArticle {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { title: fallbackTitle, body: '' };

  try {
    const data = parseLenientLlmJson(trimmed) as { title?: unknown; body?: unknown };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (title && body) return { title, body };
      if (body) return { title: title || fallbackTitle, body };
    }
  } catch {
    /* 非 JSON：走 Markdown 标题回退 */
  }

  const lines = trimmed.split('\n');
  const h1Idx = lines.findIndex((l) => /^#(?!#)\s+/.test(l.trim()));
  if (h1Idx >= 0) {
    const title = lines[h1Idx].trim().replace(/^#+\s+/, '').trim();
    const body = [...lines.slice(0, h1Idx), ...lines.slice(h1Idx + 1)].join('\n').trim();
    return { title: title || fallbackTitle, body: body || trimmed };
  }

  return { title: fallbackTitle, body: trimmed };
}
