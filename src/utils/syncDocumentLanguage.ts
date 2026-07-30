import type { i18n as I18nInstance } from 'i18next';

/**
 * 把当前语言写到 `<html lang>` 并跟随切换。
 *
 * 除了无障碍与浏览器断词，`index.css` 还依赖它按语言收敛装饰性小标签的字距
 * （`tracking-wider` 对中文会把字拉散）。
 */
export function syncDocumentLanguage(i18n: I18nInstance): () => void {
  if (typeof document === 'undefined') return () => {};

  const apply = (lng: string) => {
    document.documentElement.lang = lng || 'en';
  };

  apply(i18n.language);
  i18n.on('languageChanged', apply);
  return () => i18n.off('languageChanged', apply);
}
