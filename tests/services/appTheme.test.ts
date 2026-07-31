import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  APP_THEME_STORAGE_KEY,
  getAppTheme,
  getAppThemeId,
  resetAppThemeStoreForTests,
  setAppThemeId,
  subscribeAppTheme,
} from '../../src/services/appTheme';
import { APP_THEMES, DEFAULT_APP_THEME_ID, resolveAppTheme } from '../../src/constants/appThemes';
import { syncDocumentTheme } from '../../src/utils/syncDocumentTheme';

describe('appTheme store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAppThemeStoreForTests();
  });

  it('未设置时用默认主题', () => {
    expect(getAppThemeId()).toBe(DEFAULT_APP_THEME_ID);
    expect(getAppTheme().id).toBe(DEFAULT_APP_THEME_ID);
  });

  it('setAppThemeId 写入 localStorage 并通知订阅者', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAppTheme(() => seen.push(getAppThemeId()));

    setAppThemeId('midnight');

    expect(getAppThemeId()).toBe('midnight');
    expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('midnight');
    expect(seen).toEqual(['midnight']);
    unsubscribe();
  });

  it('重复设置同一个主题不再通知（避免无谓重渲染）', () => {
    setAppThemeId('neo');
    const listener = vi.fn();
    const unsubscribe = subscribeAppTheme(listener);

    setAppThemeId('neo');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('退订后不再收到通知', () => {
    const listener = vi.fn();
    subscribeAppTheme(listener)();
    setAppThemeId('minimal');
    expect(listener).not.toHaveBeenCalled();
  });

  it('存储里是脏数据时回落到默认主题，而不是崩掉', () => {
    localStorage.setItem(APP_THEME_STORAGE_KEY, 'not-a-theme');
    resetAppThemeStoreForTests();
    expect(getAppThemeId()).toBe(DEFAULT_APP_THEME_ID);
  });

  it('未知 id 传进 setAppThemeId 时被忽略', () => {
    setAppThemeId('bogus' as never);
    expect(getAppThemeId()).toBe(DEFAULT_APP_THEME_ID);
  });
});

describe('appThemes 表', () => {
  it('每套主题的外壳编号都在 0..3（小票外壳已移除）', () => {
    for (const theme of APP_THEMES) {
      expect(theme.noteLayout).toBeGreaterThanOrEqual(0);
      expect(theme.noteLayout).toBeLessThanOrEqual(3);
      expect(theme.themeLayout).toBeGreaterThanOrEqual(0);
      expect(theme.themeLayout).toBeLessThanOrEqual(3);
    }
  });

  it('四套主题各占一个便签外壳，没有形态被浪费', () => {
    const layouts = APP_THEMES.map((theme) => theme.noteLayout);
    expect(new Set(layouts).size).toBe(APP_THEMES.length);
  });

  it('resolveAppTheme 对未知值给默认主题', () => {
    expect(resolveAppTheme(undefined).id).toBe(DEFAULT_APP_THEME_ID);
    expect(resolveAppTheme('nope').id).toBe(DEFAULT_APP_THEME_ID);
  });
});

describe('syncDocumentTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAppThemeStoreForTests();
    document.documentElement.removeAttribute('data-theme');
  });

  it('立即写入当前主题并跟随切换', () => {
    const stop = syncDocumentTheme();
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_APP_THEME_ID);

    setAppThemeId('midnight');
    expect(document.documentElement.dataset.theme).toBe('midnight');

    stop();
  });

  it('停止后不再跟随（避免卸载后仍改 DOM）', () => {
    const stop = syncDocumentTheme();
    stop();
    setAppThemeId('neo');
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_APP_THEME_ID);
  });
});
