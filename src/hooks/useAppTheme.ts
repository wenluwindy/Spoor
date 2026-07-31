import { useSyncExternalStore } from 'react';
import type { AppThemeDefinition } from '../constants/appThemes';
import { getAppTheme, subscribeAppTheme } from '../services/appTheme';

/**
 * 订阅当前主题。返回整份定义（含 `noteLayout` / `themeLayout`），
 * 节点外壳据此决定渲染哪套形态。
 */
export function useAppTheme(): AppThemeDefinition {
  return useSyncExternalStore(subscribeAppTheme, getAppTheme, getAppTheme);
}
