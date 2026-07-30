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

// Mock window.confirm and window.alert to prevent test interruptions
window.confirm = () => true;
window.alert = () => {};

// Mock requestFullscreen / exitFullscreen (not available in jsdom)
Element.prototype.requestFullscreen = Element.prototype.requestFullscreen || (async () => {});
document.exitFullscreen = document.exitFullscreen || (async () => {});
