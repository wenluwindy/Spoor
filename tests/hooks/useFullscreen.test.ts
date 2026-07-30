import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useFullscreen } from '../../src/hooks/useFullscreen';

describe('useFullscreen', () => {
  beforeEach(() => {
    // Reset fullscreen state
    Object.defineProperty(document, 'fullscreenElement', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('初始状态 isFullscreen 为 false', () => {
    const ref = createRef<HTMLDivElement>();
    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.isFullscreen).toBe(false);
  });

  it('调用 toggleFullscreen 进入全屏', () => {
    const div = document.createElement('div');
    const requestFullscreenSpy = vi.spyOn(div, 'requestFullscreen').mockResolvedValue(undefined);
    const ref = { current: div };

    const { result } = renderHook(() => useFullscreen(ref));

    act(() => {
      result.current.toggleFullscreen();
    });

    expect(requestFullscreenSpy).toHaveBeenCalled();
  });

  it('已全屏时调用 toggleFullscreen 退出全屏', () => {
    const exitFullscreenSpy = vi.spyOn(document, 'exitFullscreen').mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.createElement('div'),
      writable: true,
      configurable: true,
    });
    const ref = createRef<HTMLDivElement>();

    const { result } = renderHook(() => useFullscreen(ref));

    act(() => {
      result.current.toggleFullscreen();
    });

    expect(exitFullscreenSpy).toHaveBeenCalled();
  });

  it('fullscreenchange 事件更新 isFullscreen 状态', () => {
    const ref = createRef<HTMLDivElement>();
    const { result } = renderHook(() => useFullscreen(ref));

    // 模拟进入全屏
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(true);

    // 模拟退出全屏
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(false);
  });

  it('卸载时移除 fullscreenchange 监听器', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const ref = createRef<HTMLDivElement>();
    const { unmount } = renderHook(() => useFullscreen(ref));

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
  });
});
