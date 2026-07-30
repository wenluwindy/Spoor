import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerCanvasUnloadFlush } from '../../src/utils/registerCanvasUnloadFlush';

describe('registerCanvasUnloadFlush', () => {
  let pagehideHandler: (() => void) | undefined;
  let beforeunloadHandler: (() => void) | undefined;

  beforeEach(() => {
    pagehideHandler = undefined;
    beforeunloadHandler = undefined;
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'pagehide') pagehideHandler = handler as () => void;
      if (type === 'beforeunload') beforeunloadHandler = handler as () => void;
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('注册 pagehide 与 beforeunload 监听', () => {
    registerCanvasUnloadFlush();
    expect(pagehideHandler).toBeTypeOf('function');
    expect(beforeunloadHandler).toBeTypeOf('function');
  });

  it('卸载时移除监听', () => {
    const remove = registerCanvasUnloadFlush();
    remove();
    expect(window.removeEventListener).toHaveBeenCalledWith('pagehide', pagehideHandler);
    expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', beforeunloadHandler);
  });

  it('pagehide 时对当前 contentEditable 触发 blur', () => {
    const ce = document.createElement('div');
    Object.defineProperty(ce, 'isContentEditable', { get: () => true });
    const blurSpy = vi.spyOn(ce, 'blur');
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(ce);

    registerCanvasUnloadFlush();
    pagehideHandler?.();

    expect(blurSpy).toHaveBeenCalledTimes(1);
  });
});
