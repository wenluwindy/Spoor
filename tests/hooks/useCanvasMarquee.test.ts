import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useCanvasMarquee } from '../../src/hooks/useCanvasMarquee';

function nodeAt(left: number, top: number, right: number, bottom: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      x: left, y: top, left, top, right, bottom,
      width: right - left, height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

/** 画布容器固定在 (0,0)，方便直接用 client 坐标推断结果。 */
function useTestMarquee(nodes: Record<string, HTMLElement | null>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const main = useRef<HTMLElement | null>(null);
  if (!main.current) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    main.current = el;
  }
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const marquee = useCanvasMarquee({
    mainRef: main,
    nodesRef,
    setSelectedNodes: setSelected,
  });
  return { ...marquee, selected };
}

function pointerDown(x: number, y: number, opts: { button?: number; shiftKey?: boolean } = {}) {
  return {
    button: opts.button ?? 0,
    shiftKey: opts.shiftKey ?? false,
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent;
}

function drag(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
}

function release(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));
}

const NODES = {
  // 左上
  a: nodeAt(50, 50, 150, 150),
  // 中间
  b: nodeAt(300, 200, 400, 300),
  // 右下，远离前两者
  c: nodeAt(700, 600, 800, 700),
};

describe('useCanvasMarquee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始没有选框', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    expect(result.current.marquee).toBeNull();
  });

  it('非左键不启动框选', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(10, 10, { button: 1 }));
      drag(500, 500);
    });
    expect(result.current.marquee).toBeNull();
  });

  it('拖动时给出归一化后的选框（left/top/宽高恒为正）', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(400, 300));
      drag(200, 100);
    });
    // 反向拖动也要得到正的宽高
    expect(result.current.marquee).toEqual({ left: 200, top: 100, width: 200, height: 200 });
  });

  it('松手后选框消失', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(500, 500);
      release(500, 500);
    });
    expect(result.current.marquee).toBeNull();
  });

  it('框内节点被选中，框外不被选中', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(500, 400);
      release(500, 400);
    });
    expect([...result.current.selected].sort()).toEqual(['a', 'b']);
  });

  it('相交即算命中，不要求完全包含', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      // 只压到 a 的右下角一小块
      result.current.handleMarqueeStart(pointerDown(140, 140));
      drag(200, 200);
      release(200, 200);
    });
    expect([...result.current.selected]).toEqual(['a']);
  });

  it('默认替换原有选中', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(200, 200);
      release(200, 200);
    });
    expect([...result.current.selected]).toEqual(['a']);

    act(() => {
      result.current.handleMarqueeStart(pointerDown(650, 550));
      drag(850, 750);
      release(850, 750);
    });
    expect([...result.current.selected]).toEqual(['c']);
  });

  it('按住 Shift 为追加选择', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(200, 200);
      release(200, 200);
    });
    act(() => {
      result.current.handleMarqueeStart(pointerDown(650, 550, { shiftKey: true }));
      drag(850, 750);
      release(850, 750);
    });
    expect([...result.current.selected].sort()).toEqual(['a', 'c']);
  });

  it('空白处单击（位移过小）清空选中，而不是画零面积框', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(200, 200);
      release(200, 200);
    });
    expect(result.current.selected.size).toBe(1);

    act(() => {
      result.current.handleMarqueeStart(pointerDown(600, 400));
      drag(601, 401);
      release(601, 401);
    });
    expect(result.current.selected.size).toBe(0);
    expect(result.current.marquee).toBeNull();
  });

  it('Shift + 空白处单击不清空选中', () => {
    const { result } = renderHook(() => useTestMarquee(NODES));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(200, 200);
      release(200, 200);
    });
    act(() => {
      result.current.handleMarqueeStart(pointerDown(600, 400, { shiftKey: true }));
      release(600, 400);
    });
    expect([...result.current.selected]).toEqual(['a']);
  });

  it('忽略已卸载的节点（ref 为 null）', () => {
    const { result } = renderHook(() => useTestMarquee({ ...NODES, gone: null }));
    act(() => {
      result.current.handleMarqueeStart(pointerDown(0, 0));
      drag(900, 800);
      release(900, 800);
    });
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
  });
});
