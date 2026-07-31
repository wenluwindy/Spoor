import type { SearchProviderKind } from '../types/aiConfig';

/**
 * 联网搜索服务的元信息：设置页据此渲染，`services/search` 据此分发。
 *
 * 只收「能直接喂给模型」的搜索 API——返回结构里得有标题、链接和一段摘要，
 * 纯链接列表还得再抓一遍正文，那是另一件事。
 */
export interface SearchProviderMeta {
  kind: SearchProviderKind;
  /** 设置页上的显示名，品牌名不翻译。 */
  label: string;
  /** Key 输入框的占位符，照各家实际的 Key 前缀写。 */
  keyPlaceholder: string;
  /** 申请 Key 的页面。 */
  consoleUrl: string;
}

export const DEFAULT_SEARCH_PROVIDER: SearchProviderKind = 'metaso';

export const SEARCH_PROVIDERS: SearchProviderMeta[] = [
  {
    kind: 'metaso',
    label: 'Metaso',
    keyPlaceholder: 'sk-metaso-...',
    consoleUrl: 'https://metaso.cn/search-api',
  },
  {
    kind: 'tavily',
    label: 'Tavily',
    keyPlaceholder: 'tvly-...',
    consoleUrl: 'https://app.tavily.com/home',
  },
];

export function isSearchProviderKind(value: unknown): value is SearchProviderKind {
  return SEARCH_PROVIDERS.some((p) => p.kind === value);
}
