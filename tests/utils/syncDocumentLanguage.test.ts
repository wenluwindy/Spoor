import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncDocumentLanguage } from '../../src/utils/syncDocumentLanguage';
import type { i18n as I18nInstance } from 'i18next';

function fakeI18n(initial: string) {
  const handlers = new Set<(lng: string) => void>();
  return {
    language: initial,
    on: (_evt: string, fn: (lng: string) => void) => handlers.add(fn),
    off: (_evt: string, fn: (lng: string) => void) => handlers.delete(fn),
    emit: (lng: string) => handlers.forEach((fn) => fn(lng)),
    handlerCount: () => handlers.size,
  };
}

describe('syncDocumentLanguage', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('lang');
  });

  it('立即写入当前语言', () => {
    const i18n = fakeI18n('zh');
    syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(document.documentElement.lang).toBe('zh');
  });

  it('跟随语言切换更新', () => {
    const i18n = fakeI18n('en');
    syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(document.documentElement.lang).toBe('en');

    i18n.emit('zh');
    expect(document.documentElement.lang).toBe('zh');
  });

  it('语言为空时回退到 en，避免 <html lang=""> ', () => {
    const i18n = fakeI18n('');
    syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(document.documentElement.lang).toBe('en');
  });

  it('返回的清理函数会解绑监听', () => {
    const i18n = fakeI18n('en');
    const dispose = syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(i18n.handlerCount()).toBe(1);

    dispose();
    expect(i18n.handlerCount()).toBe(0);
  });

  it('中文下 index.css 依赖的选择器条件成立（lang 以 zh 开头）', () => {
    const i18n = fakeI18n('zh-CN');
    syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(document.documentElement.matches('html[lang^="zh"]')).toBe(true);
  });

  it('英文下不匹配该选择器', () => {
    const i18n = fakeI18n('en');
    syncDocumentLanguage(i18n as unknown as I18nInstance);
    expect(document.documentElement.matches('html[lang^="zh"]')).toBe(false);
  });
});
