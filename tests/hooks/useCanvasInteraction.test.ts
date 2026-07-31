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
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
    // window 的 spy 是全局的，不清掉的话 getWheelHandler 会抓到上一个用例的处理函数
    vi.mocked(window.addEventListener).mockClear();
  });

  /**
   * 取出 hook 注册的 wheel 处理函数。
   *
   * 监听挂在 window 上（而不是 <main>）是刻意的：画布切页会被卸载重建，
   * 挂在元素上的监听器会留在旧节点上失效。见 useCanvasInteraction 的注释。
   *
   * 取**最后**一个：同一个用例里可能渲染多次 hook，最新注册的才是当前这个。
   */
  const getWheelHandler = () => {
    const calls = vi.mocked(window.addEventListener).mock.calls.filter((c) => c[0] === 'wheel');
    return calls.at(-1)?.[1] as (e: WheelEvent) => void;
  };

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

  it('wheel 注册在 window 上而不是画布元素上', () => {
    setupHook();
    expect(window.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), {
      passive: false,
    });
  });

  it('画布卸载重建后滚轮仍然缩放（切页回来不失效）', () => {
    // 回归：监听曾经挂在 mainRef.current 上，而 effect 只依赖稳定的 ref 对象，
    // 于是切走再切回来时监听器还留在那个已被丢弃的旧 <main> 上，滚轮就不响应了。
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const { result } = renderHook(() =>
      useCanvasInteraction(
        mainRef,
        createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>,
        createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>,
        createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>,
        { current: {} } as React.RefObject<Record<string, HTMLElement | null>>,
        null,
        vi.fn(),
      ),
    );

    // 模拟切到别的页再切回来：<main> 换成了一个全新的节点
    const remounted = document.createElement('div');
    vi.spyOn(remounted, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    mainRef.current = remounted;

    const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, clientX: 400, clientY: 300 });
    Object.defineProperty(e, 'target', { value: remounted, enumerable: true });
    act(() => {
      getWheelHandler()(e);
    });

    expect(result.current.canvasTransform.scale).toBeGreaterThan(1);
  });

  it('指针在画布之外时不缩放，滚动交还给浏览器', () => {
    const { result } = setupHook();
    const outside = document.createElement('div');

    const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'target', { value: outside, enumerable: true });
    act(() => {
      getWheelHandler()(e);
    });

    expect(result.current.canvasTransform.scale).toBe(1);
    expect(e.defaultPrevented).toBe(false);
  });

  it('wheel 在仍可纵向滚动的子元素内时提前返回，不触发画布平移', () => {
    const { result } = setupHook();
    const onWheel = getWheelHandler();
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
    const onWheel = getWheelHandler();
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
    const onWheel = getWheelHandler();

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
    const onWheel = getWheelHandler();

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
      const onWheel = getWheelHandler();
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
