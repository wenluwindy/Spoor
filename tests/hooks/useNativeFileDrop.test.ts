import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { physicalToClientPoint, useNativeFileDrop } from '../../src/hooks/useNativeFileDrop';

type DragPayload =
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'leave' }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } };

const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
const onDragDropEvent = vi.hoisted(() => vi.fn());
const unlisten = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

/** 拿到订阅时传入的回调，用来手动派发事件。 */
let emit: ((event: { payload: DragPayload }) => void) | null = null;

describe('physicalToClientPoint', () => {
  it('1x 屏幕上原样', () => {
    expect(physicalToClientPoint({ x: 100, y: 200 }, 1)).toEqual({ x: 100, y: 200 });
  });

  it('缩放屏幕上按 devicePixelRatio 换算', () => {
    // 125% 缩放：物理 500 其实是 CSS 400，不换算会偏出一大截
    expect(physicalToClientPoint({ x: 500, y: 250 }, 1.25)).toEqual({ x: 400, y: 200 });
    expect(physicalToClientPoint({ x: 300, y: 300 }, 2)).toEqual({ x: 150, y: 150 });
  });

  it('ratio 非法时按 1 处理，不产生 Infinity/NaN', () => {
    expect(physicalToClientPoint({ x: 100, y: 100 }, 0)).toEqual({ x: 100, y: 100 });
    expect(physicalToClientPoint({ x: 100, y: 100 }, -2)).toEqual({ x: 100, y: 100 });
  });
});

describe('useNativeFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
    emit = null;
    onDragDropEvent.mockImplementation((cb: (e: { payload: DragPayload }) => void) => {
      emit = cb;
      return Promise.resolve(unlisten);
    });
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  it('enabled 时订阅原生拖放事件', async () => {
    renderHook(() => useNativeFileDrop({ enabled: true, onDrop: vi.fn() }));
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalledTimes(1));
  });

  it('disabled 时不订阅', () => {
    renderHook(() => useNativeFileDrop({ enabled: false, onDrop: vi.fn() }));
    expect(onDragDropEvent).not.toHaveBeenCalled();
  });

  it('非桌面端不订阅', () => {
    isTauriRuntime.mockReturnValue(false);
    renderHook(() => useNativeFileDrop({ enabled: true, onDrop: vi.fn() }));
    expect(onDragDropEvent).not.toHaveBeenCalled();
  });

  it('over/leave 切换拖放高亮', async () => {
    const { result } = renderHook(() => useNativeFileDrop({ enabled: true, onDrop: vi.fn() }));
    await waitFor(() => expect(emit).not.toBeNull());

    expect(result.current.isDragOver).toBe(false);
    act(() => emit!({ payload: { type: 'over', position: { x: 0, y: 0 } } }));
    expect(result.current.isDragOver).toBe(true);

    act(() => emit!({ payload: { type: 'leave' } }));
    expect(result.current.isDragOver).toBe(false);
  });

  it('drop 时回调路径与换算后的坐标，并收起高亮', async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useNativeFileDrop({ enabled: true, onDrop }));
    await waitFor(() => expect(emit).not.toBeNull());

    act(() => emit!({ payload: { type: 'over', position: { x: 0, y: 0 } } }));
    act(() =>
      emit!({ payload: { type: 'drop', paths: ['D:\\a.png'], position: { x: 400, y: 300 } } }),
    );

    expect(onDrop).toHaveBeenCalledWith(['D:\\a.png'], { x: 400, y: 300 });
    expect(result.current.isDragOver).toBe(false);
  });

  it('drop 坐标按 devicePixelRatio 换算', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const onDrop = vi.fn();
    renderHook(() => useNativeFileDrop({ enabled: true, onDrop }));
    await waitFor(() => expect(emit).not.toBeNull());

    act(() => emit!({ payload: { type: 'drop', paths: ['a'], position: { x: 800, y: 600 } } }));
    expect(onDrop).toHaveBeenCalledWith(['a'], { x: 400, y: 300 });
  });

  it('空路径的 drop 不回调', async () => {
    const onDrop = vi.fn();
    renderHook(() => useNativeFileDrop({ enabled: true, onDrop }));
    await waitFor(() => expect(emit).not.toBeNull());

    act(() => emit!({ payload: { type: 'drop', paths: [], position: { x: 0, y: 0 } } }));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('onDrop 身份变了也不重新订阅，拖放高亮不会被 cleanup 抹掉', async () => {
    // onDrop 闭包了画布变换与落库函数，每次渲染都是新身份。若它进依赖数组，
    // 每次渲染都退订重订，cleanup 里的 setIsDragOver(false) 会把刚亮起的提示抹掉
    const { result, rerender } = renderHook(
      ({ onDrop }: { onDrop: (p: string[], pt: { x: number; y: number }) => void }) =>
        useNativeFileDrop({ enabled: true, onDrop }),
      { initialProps: { onDrop: vi.fn() } },
    );
    await waitFor(() => expect(emit).not.toBeNull());

    act(() => emit!({ payload: { type: 'over', position: { x: 0, y: 0 } } }));
    expect(result.current.isDragOver).toBe(true);

    rerender({ onDrop: vi.fn() });

    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(unlisten).not.toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(true);
  });

  it('总是调用最新的 onDrop（ref 不会用旧闭包）', async () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { rerender } = renderHook(
      ({ onDrop }: { onDrop: (p: string[], pt: { x: number; y: number }) => void }) =>
        useNativeFileDrop({ enabled: true, onDrop }),
      { initialProps: { onDrop: stale } },
    );
    await waitFor(() => expect(emit).not.toBeNull());

    rerender({ onDrop: fresh });
    act(() => emit!({ payload: { type: 'drop', paths: ['a'], position: { x: 10, y: 20 } } }));

    expect(fresh).toHaveBeenCalledWith(['a'], { x: 10, y: 20 });
    expect(stale).not.toHaveBeenCalled();
  });

  it('卸载时退订', async () => {
    const { unmount } = renderHook(() => useNativeFileDrop({ enabled: true, onDrop: vi.fn() }));
    await waitFor(() => expect(emit).not.toBeNull());

    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it('订阅还没返回就卸载：拿到句柄后立刻退订，不留悬空监听', async () => {
    let resolveSubscribe: ((fn: () => void) => void) | null = null;
    onDragDropEvent.mockImplementation(
      () => new Promise<() => void>((resolve) => (resolveSubscribe = resolve)),
    );

    const { unmount } = renderHook(() => useNativeFileDrop({ enabled: true, onDrop: vi.fn() }));
    unmount();

    await waitFor(() => expect(resolveSubscribe).not.toBeNull());
    await act(async () => {
      resolveSubscribe!(unlisten);
    });
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
