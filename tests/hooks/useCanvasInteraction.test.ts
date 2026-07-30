import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useCanvasInteraction } from '../../src/hooks/useCanvasInteraction';

describe('useCanvasInteraction', () => {
  let mainEl: HTMLDivElement;

  beforeEach(() => {
    mainEl = document.createElement('div');
    vi.spyOn(mainEl, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    vi.spyOn(mainEl, 'addEventListener');
    vi.spyOn(mainEl, 'removeEventListener');
  });

  const setupHook = () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    return renderHook(() =>
      useCanvasInteraction(mainRef, contentContainerRef, svgRef, edgeLabelsRef, nodesRef, null, setConnectingFrom)
    );
  };

  it('初始 transform 为 {x:0, y:0, scale:1}', () => {
    const { result } = setupHook();
    expect(result.current.canvasTransform).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('setCanvasTransform 更新 transform', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 100, y: 200, scale: 1.5 });
    });
    expect(result.current.canvasTransform).toEqual({ x: 100, y: 200, scale: 1.5 });
  });

  it('transformRef 同步更新', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 50, y: 60, scale: 2 });
    });
    expect(result.current.transformRef.current).toEqual({ x: 50, y: 60, scale: 2 });
  });

  it('wheel 事件注册到 mainRef 元素', () => {
    setupHook();
    expect(mainEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
  });

  it('wheel 在仍可纵向滚动的子元素内时提前返回，不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触底时仍不触发画布平移（避免穿透滚动）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      // 已滚到底：scrollTop + clientHeight >= scrollHeight - 1
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触顶时仍不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('可滚动子区域内不缩放画布（长文卡片里要能正常翻内容）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform.scale).toBe(1);
    gcs.mockRestore();
  });

  describe('滚轮 = 缩放画布', () => {
    function fireWheel(deltaY: number, at = { clientX: 500, clientY: 400 }) {
      const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
      const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
      const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...at });
      Object.defineProperty(e, 'target', { value: mainEl, enumerable: true });
      act(() => {
        onWheel(e);
      });
      return e;
    }

    it('上滑放大、下滑缩小（不需要按 Ctrl）', () => {
      const { result } = setupHook();

      fireWheel(-100);
      const zoomedIn = result.current.canvasTransform.scale;
      expect(zoomedIn).toBeGreaterThan(1);

      fireWheel(100);
      expect(result.current.canvasTransform.scale).toBeLessThan(zoomedIn);
    });

    it('阻止默认行为（否则 WebView 会连带滚动页面）', () => {
      setupHook();
      const e = fireWheel(-100);
      expect(e.defaultPrevented).toBe(true);
    });

    it('以指针为锚点：指针下的画布坐标缩放前后不变', () => {
      const { result } = setupHook();
      const at = { clientX: 700, clientY: 300 };

      const before = result.current.canvasTransform;
      const canvasPointBefore = {
        x: (at.clientX - before.x) / before.scale,
        y: (at.clientY - before.y) / before.scale,
      };

      fireWheel(-100, at);

      const after = result.current.canvasTransform;
      const canvasPointAfter = {
        x: (at.clientX - after.x) / after.scale,
        y: (at.clientY - after.y) / after.scale,
      };
      expect(canvasPointAfter.x).toBeCloseTo(canvasPointBefore.x, 5);
      expect(canvasPointAfter.y).toBeCloseTo(canvasPointBefore.y, 5);
    });

    it('缩放范围收在 0.1 ~ 5', () => {
      const { result } = setupHook();
      for (let i = 0; i < 200; i++) fireWheel(-100);
      expect(result.current.canvasTransform.scale).toBeLessThanOrEqual(5);

      for (let i = 0; i < 400; i++) fireWheel(100);
      expect(result.current.canvasTransform.scale).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('平移画布 = 按住中键拖动', () => {
    function pointerDown(button: number) {
      return {
        target: mainEl,
        currentTarget: mainEl,
        button,
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent;
    }

    it('中键按下注册 pointermove/pointerup 并阻止默认（压掉 Windows 自动滚动）', () => {
      const { result } = setupHook();
      const addSpy = vi.spyOn(window, 'addEventListener');
      const e = pointerDown(1);

      act(() => {
        result.current.handlePanStart(e);
      });

      expect(e.preventDefault).toHaveBeenCalled();
      expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    });

    it('中键拖动改变 transform', () => {
      const { result } = setupHook();
      act(() => {
        result.current.handlePanStart(pointerDown(1));
      });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 130 }));
      });
      expect(result.current.canvasTransform.x).toBe(60);
      expect(result.current.canvasTransform.y).toBe(30);
    });

    it.each([
      ['左键（留给框选）', 0],
      ['右键（留给上下文菜单）', 2],
    ])('%s 不平移画布', (_label, button) => {
      const { result } = setupHook();
      const addSpy = vi.spyOn(window, 'addEventListener');
      // 同一对象上的 spy 会跨用例累积调用记录，先清干净再断言
      addSpy.mockClear();
      const e = pointerDown(button);

      act(() => {
        result.current.handlePanStart(e);
      });

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(addSpy).not.toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(result.current.canvasTransform).toEqual({ x: 0, y: 0, scale: 1 });
    });
  });
});
