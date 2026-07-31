import { getAppThemeId, subscribeAppTheme } from '../services/appTheme';

/**
 * 把当前主题写到 `<html data-theme>` 并跟随切换。
 *
 * 与 `syncDocumentLanguage` 同构：`index.css` 里的 `html[data-theme=...]` 覆盖块
 * 靠这个属性生效，全站颜色令牌随之穿透。
 */
export function syncDocumentTheme(): () => void {
  if (typeof document === 'undefined') return () => {};

  const apply = () => {
    document.documentElement.dataset.theme = getAppThemeId();
  };

  apply();
  return subscribeAppTheme(apply);
}
