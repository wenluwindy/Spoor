import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasLinkDrag, LINK_DRAG_THRESHOLD_PX } from '../../src/hooks/useCanvasLinkDrag';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../../src/services/keyboardLayers';

/**
 * 连线的拖放结算。
 *
 * 用真实 DOM + 真实事件而不是抓监听器：命中判定走 `document.elementFromPoint`，
 * 桩掉它比让事件真的跑一遍更容易写出「测试过但线上不对」的结果。
 */
describe('useCanvasLinkDrag', () => {
  let canvas: HTMLDivElement;
  let nodeEl: HTMLDivElement;
  let outside: HTMLDivElement;
  let handlers: {
    onDropOnNode: Mock<(toId: string) => void>;
    onDropOnCanvas: Mock<(fromId: string, x: number, y: number) => void>;
    onCancel: Mock<() => void>;
  };

  beforeEach(() => {
    canvas = document.createElement('div');
    canvas.setAttribute('data-canvas-surface', '');
    nodeEl = document.createElement('div');
    nodeEl.setAttribute('data-node-id', 'target-node');
    canvas.appendChild(nodeEl);

    outside = document.createElement('div');
    document.body.append(canvas, outside);

    handlers = { onDropOnNode: vi.fn(), onDropOnCanvas: vi.fn(), onCancel: vi.fn() };

    // jsdom 没实现 elementFromPoint，先补一个空实现，spyOn 才有东西可替
    if (!document.elementFromPoint) {
      (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
        null;
    }
  });

  afterEach(() => {
    canvas.remove();
    outside.remove();
    vi.restoreAllMocks();
  });

  const setup = (connectingFrom: string | null) =>
    renderHook(() => useCanvasLinkDrag({ connectingFrom, ...handlers }));

  /** 让命中判定落到指定元素上。 */
  const hitTest = (el: Element | null) =>
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el as Element);

  function press(x: number, y: number) {
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
  }
  function release(x: number, y: number) {
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
  }

  it('拖到节点上松手就连过去', () => {
    setup('source-node');
    hitTest(nodeEl);

    press(10, 10);
    release(200, 200);

    expect(handlers.onDropOnNode).toHaveBeenCalledWith('target-node');
    expect(handlers.onDropOnCanvas).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('拖到节点内部的子元素上也算命中该节点', () => {
    const inner = document.createElement('span');
    nodeEl.appendChild(inner);
    setup('source-node');
    hitTest(inner);

    press(10, 10);
    release(200, 200);

    expect(handlers.onDropOnNode).toHaveBeenCalledWith('target-node');
  });

  it('拖到画布空白处松手交给调用方弹新建菜单', () => {
    setup('source-node');
    hitTest(canvas);

    press(10, 10);
    release(300, 240);

    expect(handlers.onDropOnCanvas).toHaveBeenCalledWith('source-node', 300, 240);
    expect(handlers.onDropOnNode).not.toHaveBeenCalled();
  });

  it('松在画布之外（侧边栏等）就放弃这根线', () => {
    setup('source-node');
    hitTest(outside);

    press(10, 10);
    release(400, 400);

    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onDropOnCanvas).not.toHaveBeenCalled();
  });

  it('几乎没动就松手时什么都不做，保留点击-点击的老手势', () => {
    setup('source-node');
    hitTest(canvas);

    press(10, 10);
    release(10 + LINK_DRAG_THRESHOLD_PX - 1, 10);

    expect(handlers.onDropOnNode).not.toHaveBeenCalled();
    expect(handlers.onDropOnCanvas).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('没有在连线时，拖动松手一概不管', () => {
    setup(null);
    hitTest(nodeEl);

    press(10, 10);
    release(300, 300);

    expect(handlers.onDropOnNode).not.toHaveBeenCalled();
    expect(handlers.onDropOnCanvas).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('Esc 放弃正在拉的线', () => {
    setup('source-node');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('没在连线时 Esc 不触发取消', () => {
    setup(null);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('连线中占住 linkdrag 层压过画布；上面还有更高的层时 Esc 让给它们', () => {
    const { unmount } = setup('source-node');
    // 连线态挂上后画布不再是最高层——同一下 Esc 不会又落到清选区
    expect(isTopKeyboardLayer('canvas')).toBe(false);
    expect(isTopKeyboardLayer('linkdrag')).toBe(true);

    const release = acquireKeyboardLayer('modal');
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(handlers.onCancel).not.toHaveBeenCalled();
    } finally {
      release();
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });

  it('连线途中右键取消，并且不让右键菜单弹出来', () => {
    setup('source-node');
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    window.dispatchEvent(e);

    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('没在连线时右键照常弹菜单', () => {
    setup(null);
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    window.dispatchEvent(e);

    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('一次拖动只结算一次，再来一次 pointerup 不重复触发', () => {
    // 回归：结算完必须把按下点清掉，否则一次按下能被反复结算
    setup('source-node');
    hitTest(canvas);

    press(10, 10);
    release(300, 240);
    release(320, 260);

    expect(handlers.onDropOnCanvas).toHaveBeenCalledTimes(1);
  });
});
