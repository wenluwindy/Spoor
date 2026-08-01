import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggable } from '../../src/hooks/useDraggable';
import {
  beginGroupDrag,
  endGroupDrag,
  publishGroupDelta,
  resetGroupDragForTests,
} from '../../src/services/canvasGroupDrag';

/**
 * 重点是**外部坐标同步**：撤销一次移动、方向键微调改的都是库里的坐标，
 * 卡片必须跟着回位。缺了这条，撤销看上去"没生效"。
 */
describe('useDraggable', () => {
  beforeEach(() => {
    resetGroupDragForTests();
  });

  afterEach(() => {
    resetGroupDragForTests();
  });

  it('外部改了坐标就跟上', () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) => useDraggable(x, y, 1, undefined, { id: 'n1' }),
      { initialProps: { x: 10, y: 20 } },
    );
    expect(result.current.pos).toEqual({ x: 10, y: 20 });

    rerender({ x: 200, y: 300 });
    expect(result.current.pos).toEqual({ x: 200, y: 300 });
  });

  it('坐标没变时不换新对象，避免下游无谓重渲', () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) => useDraggable(x, y, 1, undefined, { id: 'n1' }),
      { initialProps: { x: 10, y: 20 } },
    );
    const first = result.current.pos;
    rerender({ x: 10, y: 20 });
    expect(result.current.pos).toBe(first);
  });

  it('拖拽进行中不被外部坐标打断', () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) => useDraggable(x, y, 1, undefined, { id: 'n1' }),
      { initialProps: { x: 0, y: 0 } },
    );

    act(() => {
      result.current.onPointerDown({
        button: 0,
        clientX: 0,
        clientY: 0,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 60 }));
    });
    expect(result.current.pos).toEqual({ x: 50, y: 60 });

    // 库里还是旧坐标（写库要等松手），这时它不该把卡片拽回原点
    rerender({ x: 0, y: 0 });
    expect(result.current.pos).toEqual({ x: 50, y: 60 });

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    // 松手之后外部坐标重新说了算
    rerender({ x: 999, y: 999 });
    expect(result.current.pos).toEqual({ x: 999, y: 999 });
  });

  it('作为整组拖拽的 follower 时，同样不被外部坐标打断', () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) =>
        useDraggable(x, y, 1, undefined, { id: 'follower', groupIds: ['leader', 'follower'] }),
      { initialProps: { x: 0, y: 0 } },
    );

    act(() => beginGroupDrag('leader', ['leader', 'follower']));
    act(() => publishGroupDelta('leader', 40, 40));
    expect(result.current.pos).toEqual({ x: 40, y: 40 });

    rerender({ x: 0, y: 0 });
    expect(result.current.pos).toEqual({ x: 40, y: 40 });

    act(() => endGroupDrag('leader'));
    rerender({ x: 7, y: 7 });
    expect(result.current.pos).toEqual({ x: 7, y: 7 });
  });

  it('松手后把最终坐标交给 onDragEnd', async () => {
    vi.useFakeTimers();
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useDraggable(0, 0, 1, onDragEnd, { id: 'n1' }));

    act(() => {
      result.current.onPointerDown({
        button: 0,
        clientX: 0,
        clientY: 0,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 12, clientY: 34 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(onDragEnd).toHaveBeenCalledWith({ x: 12, y: 34 });
    vi.useRealTimers();
  });
});
