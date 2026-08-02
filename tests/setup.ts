import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Polyfill crypto.randomUUID for test environment
if (!globalThis.crypto) {
  (globalThis as any).crypto = {
    randomUUID: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
  };
}

// Suppress Dexie console warnings during tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('[Dexie]') || msg.includes('IndexedDB')) return;
  originalWarn(...args);
};

// Suppress window.matchMedia not available in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// 测试环境统一按 Windows WebView2 的 UA 走：`spoor-media` 协议的源是按平台拼的
// （见 src/utils/mediaUrl.ts），不钉死的话组件测试里的 src 断言会随宿主机漂移。
Object.defineProperty(window.navigator, 'userAgent', {
  configurable: true,
  value:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Spoor-Tests',
});

// Mock window.confirm and window.alert to prevent test interruptions
window.confirm = () => true;
window.alert = () => {};

// Mock requestFullscreen / exitFullscreen (not available in jsdom)
Element.prototype.requestFullscreen = Element.prototype.requestFullscreen || (async () => {});
document.exitFullscreen = document.exitFullscreen || (async () => {});
