import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useCanvasContextMenu } from '../../src/hooks/useCanvasContextMenu';
import type { CanvasContextTarget } from '../../src/hooks/useCanvasContextMenu';

function makeTrigger(clientX: number, clientY: number, target: EventTarget | null = null) {
  return {
    clientX,
    clientY,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function useTestMenu(transform = { x: 0, y: 0, scale: 1 }) {
  const main = useRef<HTMLElement | null>(null);
  if (!main.current) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 60, top: 20, width: 800, height: 600, right: 860, bottom: 620, x: 60, y: 20, toJSON: () => ({}) }) as DOMRect;
    main.current = el;
  }
  const transformRef = useRef(transform);
  transformRef.current = transform;
  return useCanvasContextMenu(main, transformRef);
}

describe('useCanvasContextMenu', () => {
  it('初始为关闭', () => {
    const { result } = renderHook(() => useTestMenu());
    expect(result.current.menu).toBeNull();
  });

  it('打开时同时记录视口坐标与画布坐标', () => {
    const { result } = renderHook(() => useTestMenu({ x: 100, y: 50, scale: 2 }));

    act(() => {
      result.current.openContextMenu(makeTrigger(360, 220), { kind: 'canvas' });
    });

    expect(result.current.menu).toEqual({
      screenX: 360,
      screenY: 220,
      // (360 - 60 - 100) / 2 = 100 ; (220 - 20 - 50) / 2 = 75
      canvasX: 100,
      canvasY: 75,
      target: { kind: 'canvas' },
    });
  });

  it('阻止浏览器原生菜单并停止冒泡', () => {
    const { result } = renderHook(() => useTestMenu());
    const trigger = makeTrigger(10, 10);

    act(() => {
      result.current.openContextMenu(trigger, { kind: 'canvas' });
    });

    expect(trigger.preventDefault).toHaveBeenCalled();
    expect(trigger.stopPropagation).toHaveBeenCalled();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
  ])('%s 内保留原生菜单：不打开也不阻止默认行为', (_name, make) => {
    const { result } = renderHook(() => useTestMenu());
    const trigger = makeTrigger(10, 10, make());

    act(() => {
      result.current.openContextMenu(trigger, { kind: 'canvas' });
    });

    expect(result.current.menu).toBeNull();
    expect(trigger.preventDefault).not.toHaveBeenCalled();
  });

  it('contentEditable 内保留原生菜单', () => {
    const { result } = renderHook(() => useTestMenu());
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    const trigger = makeTrigger(10, 10, el);

    act(() => {
      result.current.openContextMenu(trigger, { kind: 'canvas' });
    });

    expect(result.current.menu).toBeNull();
  });

  it.each<CanvasContextTarget>([
    { kind: 'canvas' },
    { kind: 'node', nodeId: 'n1' },
    { kind: 'edge', edgeId: 'e1' },
    { kind: 'nodes', nodeIds: ['n1', 'n2'], anchorId: 'n1' },
  ])('原样保留 target：%o', (target) => {
    const { result } = renderHook(() => useTestMenu());

    act(() => {
      result.current.openContextMenu(makeTrigger(10, 10), target);
    });

    expect(result.current.menu?.target).toEqual(target);
  });

  it('closeContextMenu 收起', () => {
    const { result } = renderHook(() => useTestMenu());
    act(() => {
      result.current.openContextMenu(makeTrigger(10, 10), { kind: 'canvas' });
    });
    act(() => {
      result.current.closeContextMenu();
    });
    expect(result.current.menu).toBeNull();
  });

  it.each([
    ['滚轮缩放/平移', () => window.dispatchEvent(new Event('wheel'))],
    ['窗口尺寸变化', () => window.dispatchEvent(new Event('resize'))],
    ['窗口失焦', () => window.dispatchEvent(new Event('blur'))],
  ])('%s 时自动收起（菜单位置已失效）', (_name, fire) => {
    const { result } = renderHook(() => useTestMenu());
    act(() => {
      result.current.openContextMenu(makeTrigger(10, 10), { kind: 'canvas' });
    });
    expect(result.current.menu).not.toBeNull();

    act(() => {
      fire();
    });
    expect(result.current.menu).toBeNull();
  });

  it('按 Escape 收起', () => {
    const { result } = renderHook(() => useTestMenu());
    act(() => {
      result.current.openContextMenu(makeTrigger(10, 10), { kind: 'canvas' });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.menu).toBeNull();
  });

  it('在已打开时再次右键会换到新位置', () => {
    const { result } = renderHook(() => useTestMenu());
    act(() => {
      result.current.openContextMenu(makeTrigger(100, 100), { kind: 'canvas' });
    });
    act(() => {
      result.current.openContextMenu(makeTrigger(300, 200), { kind: 'node', nodeId: 'n9' });
    });

    expect(result.current.menu?.screenX).toBe(300);
    expect(result.current.menu?.target).toEqual({ kind: 'node', nodeId: 'n9' });
  });
});
