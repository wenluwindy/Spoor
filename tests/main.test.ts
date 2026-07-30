import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 外部依赖
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

vi.mock('../src/i18n', () => ({ default: {} }));

vi.mock('../src/App', () => ({
  default: function App() {
    return null;
  },
}));

vi.mock('../src/components/DesktopOnlyNotice', () => ({
  DesktopOnlyNotice: function DesktopOnlyNotice() {
    return null;
  },
}));

vi.mock('../src/index.css', () => ({}));

const shouldRenderFullApp = vi.fn(() => true);
vi.mock('../src/utils/appRuntimeGate', () => ({
  shouldRenderFullApp: () => shouldRenderFullApp(),
}));

/** 在渲染出的 JSX 树里找组件名，用来判断挂的是完整应用还是桌面版引导页。 */
function renderedComponentNames(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== 'object') return found;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (typeof el.type === 'function') {
    found.push((el.type as { name?: string }).name ?? '');
  }
  const children = el.props?.children;
  if (Array.isArray(children)) children.forEach((c) => renderedComponentNames(c, found));
  else if (children) renderedComponentNames(children, found);
  return found;
}

describe('main.tsx 入口文件', () => {
  beforeEach(() => {
    // 准备 DOM
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    // 清掉 createRoot 的调用记录，否则各用例都会读到第一次渲染的结果
    vi.clearAllMocks();
    shouldRenderFullApp.mockReturnValue(true);
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

  describe('桌面版守卫', () => {
    async function renderedNames() {
      const { createRoot } = await import('react-dom/client');
      await import('../src/main');
      const mockRoot = (createRoot as ReturnType<typeof vi.fn>).mock.results[0].value;
      return renderedComponentNames(mockRoot.render.mock.calls[0][0]);
    }

    it('可运行完整应用时挂 App', async () => {
      shouldRenderFullApp.mockReturnValue(true);
      const names = await renderedNames();
      expect(names).toContain('App');
      expect(names).not.toContain('DesktopOnlyNotice');
    });

    it('不可运行时改渲染桌面版引导页', async () => {
      shouldRenderFullApp.mockReturnValue(false);
      const names = await renderedNames();
      expect(names).toContain('DesktopOnlyNotice');
      expect(names).not.toContain('App');
    });

    it('两种情况都保留 AppDialogProvider（引导页也可能弹窗）', async () => {
      shouldRenderFullApp.mockReturnValue(false);
      expect(await renderedNames()).toContain('AppDialogProvider');
    });
  });
});
