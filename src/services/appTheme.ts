/**
 * 当前主题的外部 store。
 *
 * 用 store + `useSyncExternalStore` 而不是 Context：读主题的地方是每个节点外壳
 * （`NoteNode` / `ThemeNode`），它们在节点树深处按节点渲染，套一层 Provider
 * 会让整棵画布跟着主题状态重渲染。store 只通知真正订阅的组件。
 *
 * 持久化沿用 `app_language` / `user_name` 那套裸 localStorage 约定。
 */

import {
  DEFAULT_APP_THEME_ID,
  isAppThemeId,
  resolveAppTheme,
  type AppThemeDefinition,
  type AppThemeId,
} from '../constants/appThemes';

export const APP_THEME_STORAGE_KEY = 'app_theme';

const listeners = new Set<() => void>();

function readStored(): AppThemeId {
  try {
    const raw = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isAppThemeId(raw)) return raw;
  } catch {
    // 隐私模式 / 存储被禁用：走默认值，不影响渲染
  }
  return DEFAULT_APP_THEME_ID;
}

let current: AppThemeId = readStored();

export function getAppThemeId(): AppThemeId {
  return current;
}

export function getAppTheme(): AppThemeDefinition {
  return resolveAppTheme(current);
}

export function setAppThemeId(next: AppThemeId): void {
  if (!isAppThemeId(next) || next === current) return;
  current = next;
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, next);
  } catch {
    // 存不下就只在本次会话生效
  }
  listeners.forEach((fn) => fn());
}

export function subscribeAppTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：把 store 复位到 localStorage 的当前值。 */
export function resetAppThemeStoreForTests(): void {
  current = readStored();
  listeners.forEach((fn) => fn());
}
