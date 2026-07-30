import { createElement } from 'react';

/**
 * 以真实模块的导出名生成 SVG 占位图标。
 *
 * 用途是替掉「手写图标名白名单」式的 mock：那种写法在源码引入新图标时会报
 * `No "X" export is defined on the lucide-react mock`，指向的还是被引入图标的那一行，
 * 排查成本远高于问题本身。
 *
 * 因为 `vi.mock` 的工厂会被提升到 import 之前，调用方需要在工厂内部动态 import：
 *
 * ```ts
 * vi.mock('lucide-react', async (importOriginal) => {
 *   const { lucideIconMock } = await import('./lucideMock');
 *   return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
 * });
 * ```
 */
export async function lucideIconMock(
  importOriginal: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal();
  const mocked: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(actual)) {
    // 图标一律是大写开头的组件（函数或 forwardRef 对象）；createLucideIcon 之类的工具原样透传。
    const looksLikeIcon =
      /^[A-Z]/.test(name) && (typeof value === 'function' || (typeof value === 'object' && value !== null));
    mocked[name] = looksLikeIcon
      ? (props: Record<string, unknown>) =>
          createElement('svg', { 'data-testid': `icon-${name}`, ...props })
      : value;
  }

  return mocked;
}
