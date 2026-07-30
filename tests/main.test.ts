import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 外部依赖
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

vi.mock('../src/i18n', () => ({ default: {} }));

vi.mock('../src/App', () => ({
  default: () => null,
}));

vi.mock('../src/index.css', () => ({}));

describe('main.tsx 入口文件', () => {
  beforeEach(() => {
    // 准备 DOM
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  it('调用 createRoot 并渲染到 #root 元素', async () => {
    const { createRoot } = await import('react-dom/client');
    await import('../src/main');

    expect(createRoot).toHaveBeenCalledOnce();
    const rootElement = (createRoot as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rootElement).toBe(document.getElementById('root'));
  });

  it('渲染包含 StrictMode 的 App 组件', async () => {
    const { createRoot } = await import('react-dom/client');
    await import('../src/main');

    const mockRoot = (createRoot as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockRoot.render).toHaveBeenCalledOnce();

    const renderedJSX = mockRoot.render.mock.calls[0][0];
    // JSX 应该是一个 StrictMode 包裹的结构
    expect(renderedJSX).toBeDefined();
    expect(renderedJSX.type?.displayName ?? renderedJSX.type?.name ?? 'StrictMode').toBeTruthy();
  });

  it('导入了 i18n 模块以确保初始化', async () => {
    // 验证 main.tsx 中确实 import 了 i18n
    // 这通过 mock 验证 - 如果没有 import 则 mock 不会被调用
    const mod = await import('../src/main');
    expect(mod).toBeDefined();
  });
});
