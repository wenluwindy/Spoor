import { describe, it, expect, vi, afterEach } from 'vitest';

const isTauriRuntime = vi.fn();
vi.mock('../../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: () => isTauriRuntime(),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('shouldRenderFullApp', () => {
  it('在 Tauri 桌面壳内放行', async () => {
    isTauriRuntime.mockReturnValue(true);
    const { shouldRenderFullApp } = await import('../../src/utils/appRuntimeGate');
    expect(shouldRenderFullApp()).toBe(true);
  });

  it('DEV 下即使不在 Tauri 内也放行（npm run dev 浏览器调试）', async () => {
    isTauriRuntime.mockReturnValue(false);
    const { shouldRenderFullApp } = await import('../../src/utils/appRuntimeGate');
    // vitest 以 DEV 运行，因此这里等价于「非 Tauri + DEV」这一路
    expect(import.meta.env.DEV).toBe(true);
    expect(shouldRenderFullApp()).toBe(true);
  });
});
