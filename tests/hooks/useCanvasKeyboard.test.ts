import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  NUDGE_COARSE_MULTIPLIER,
  useCanvasKeyboard,
  type UseCanvasKeyboardParams,
} from '../../src/hooks/useCanvasKeyboard';
import { acquireKeyboardLayer } from '../../src/services/keyboardLayers';

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useCanvasKeyboard', () => {
  const handlers = {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDeleteSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onDuplicateSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onNudgeSelection: vi.fn(),
    onResetView: vi.fn(),
    onZoomToFit: vi.fn(),
    onOpenSearch: vi.fn(),
  };

  beforeEach(() => {
    Object.values(handlers).forEach((fn) => fn.mockClear());
    document.body.innerHTML = '';
  });

  const mount = (overrides: Partial<UseCanvasKeyboardParams> = {}) =>
    renderHook(() =>
      useCanvasKeyboard({ enabled: true, nudgeStep: 1, ...handlers, ...overrides }),
    );

  it('Ctrl+Z 撤销，Ctrl+Shift+Z 与 Ctrl+Y 重做', () => {
    mount();

    press('z', { ctrlKey: true });
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
    expect(handlers.onRedo).not.toHaveBeenCalled();

    press('z', { ctrlKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    expect(handlers.onRedo).toHaveBeenCalledTimes(2);
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('macOS 的 Cmd+Z 同样生效', () => {
    mount();
    press('z', { metaKey: true });
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('命中时阻止默认行为，免得触发浏览器自己的撤销', () => {
    mount();
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('Delete 与 Backspace 都删选区', () => {
    mount();
    press('Delete');
    press('Backspace');
    expect(handlers.onDeleteSelection).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+A 全选、Ctrl+D 复制选区', () => {
    mount();
    press('a', { ctrlKey: true });
    press('d', { ctrlKey: true });
    expect(handlers.onSelectAll).toHaveBeenCalledTimes(1);
    expect(handlers.onDuplicateSelection).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+0 复位视图、Ctrl+1 缩放至适应内容', () => {
    mount();
    press('0', { ctrlKey: true });
    press('1', { ctrlKey: true });
    expect(handlers.onResetView).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomToFit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+F 打开画布内搜索', () => {
    mount();
    expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handlers.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+F 让给全局搜索：不开画布内搜索也不吞事件', () => {
    mount();
    const event = press('f', { ctrlKey: true, shiftKey: true });
    expect(handlers.onOpenSearch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Esc 清空选区', () => {
    mount();
    press('Escape');
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('上面有弹层（拉线/菜单等）占着键盘层时 Esc 不清选区', () => {
    mount();
    const release = acquireKeyboardLayer('linkdrag');
    try {
      press('Escape');
      expect(handlers.onClearSelection).not.toHaveBeenCalled();
    } finally {
      release();
    }
    // 弹层退场后画布重新成为最高层
    press('Escape');
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('方向键按 nudgeStep 微调，四个方向的符号正确', () => {
    mount({ nudgeStep: 1 });
    press('ArrowLeft');
    press('ArrowRight');
    press('ArrowUp');
    press('ArrowDown');
    expect(handlers.onNudgeSelection.mock.calls).toEqual([
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]);
  });

  it('Shift + 方向键走十倍，网格开启时以格宽为单位', () => {
    mount({ nudgeStep: 24 });
    press('ArrowRight');
    press('ArrowRight', { shiftKey: true });
    expect(handlers.onNudgeSelection.mock.calls).toEqual([
      [24, 0],
      [24 * NUDGE_COARSE_MULTIPLIER, 0],
    ]);
  });

  it('焦点在输入框里时全部让路：Ctrl+Z 交给原生撤销，退格是删字不是删卡', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const undoEvent = press('z', { ctrlKey: true }, input);
    press('Backspace', {}, input);
    press('ArrowLeft', {}, input);

    expect(handlers.onUndo).not.toHaveBeenCalled();
    expect(handlers.onDeleteSelection).not.toHaveBeenCalled();
    expect(handlers.onNudgeSelection).not.toHaveBeenCalled();
    expect(undoEvent.defaultPrevented).toBe(false);
  });

  it('焦点在 contentEditable 便签里时同样让路', () => {
    mount();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);

    press('z', { ctrlKey: true }, editable);
    press('Delete', {}, editable);
    expect(handlers.onUndo).not.toHaveBeenCalled();
    expect(handlers.onDeleteSelection).not.toHaveBeenCalled();
  });

  it('不带修饰键的 z 不触发撤销', () => {
    mount();
    press('z');
    expect(handlers.onUndo).not.toHaveBeenCalled();
  });

  it('enabled 为 false 时完全不挂监听', () => {
    mount({ enabled: false });
    press('z', { ctrlKey: true });
    press('Delete');
    expect(handlers.onUndo).not.toHaveBeenCalled();
    expect(handlers.onDeleteSelection).not.toHaveBeenCalled();
  });

  it('卸载后不再响应', () => {
    const { unmount } = mount();
    unmount();
    press('z', { ctrlKey: true });
    expect(handlers.onUndo).not.toHaveBeenCalled();
  });
});
