import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresentation } from '../../src/hooks/usePresentation';
import { acquireKeyboardLayer } from '../../src/services/keyboardLayers';

function press(key: string, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  // 按键会触发 hook 的 setState，必须包在 act 里
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('usePresentation', () => {
  const onFocusNode = vi.fn();

  beforeEach(() => {
    onFocusNode.mockClear();
    document.body.innerHTML = '';
  });

  const mount = () => renderHook(() => usePresentation({ onFocusNode }));

  const started = (order: string[] = ['a', 'b', 'c']) => {
    const rendered = mount();
    act(() => rendered.result.current.start(order));
    return rendered;
  };

  it('初始状态：未激活、空顺序', () => {
    const { result } = mount();
    expect(result.current.active).toBe(false);
    expect(result.current.order).toEqual([]);
    expect(result.current.index).toBe(0);
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it('start 进入演示并立刻聚焦第一张', () => {
    const { result } = started();
    expect(result.current.active).toBe(true);
    expect(result.current.index).toBe(0);
    expect(onFocusNode).toHaveBeenCalledTimes(1);
    expect(onFocusNode).toHaveBeenCalledWith('a');
  });

  it('空顺序 start 不进入演示', () => {
    const { result } = mount();
    act(() => result.current.start([]));
    expect(result.current.active).toBe(false);
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it('next/prev 逐张走并聚焦，每次 index 变化都回调', () => {
    const { result } = started();
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(onFocusNode).toHaveBeenLastCalledWith('b');

    act(() => result.current.prev());
    expect(result.current.index).toBe(0);
    expect(onFocusNode).toHaveBeenLastCalledWith('a');
    expect(onFocusNode).toHaveBeenCalledTimes(3); // a → b → a
  });

  it('边界钳制：最后一张再 next、第一张再 prev 都停住且不重复聚焦', () => {
    const { result } = started(['a', 'b']);
    act(() => result.current.prev());
    expect(result.current.index).toBe(0);

    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(onFocusNode).toHaveBeenCalledTimes(2); // 只有 a、b 各一次
  });

  it('jumpTo 跳转并对越界钳制', () => {
    const { result } = started();
    act(() => result.current.jumpTo(2));
    expect(result.current.index).toBe(2);
    expect(onFocusNode).toHaveBeenLastCalledWith('c');

    act(() => result.current.jumpTo(99));
    expect(result.current.index).toBe(2);
    act(() => result.current.jumpTo(-5));
    expect(result.current.index).toBe(0);
  });

  it('exit 退出并复位', () => {
    const { result } = started();
    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
    expect(result.current.order).toEqual([]);
  });

  it('reorder 换新顺序后跟着当前卡走', () => {
    const { result } = started(['a', 'b', 'c']);
    act(() => result.current.next()); // 讲到 b
    act(() => result.current.reorder(['c', 'b', 'a']));
    expect(result.current.order).toEqual(['c', 'b', 'a']);
    expect(result.current.index).toBe(1); // b 在新顺序里还是第 2 张
    expect(onFocusNode).toHaveBeenLastCalledWith('b');
  });

  it('reorder 后当前卡不在新顺序里则钳制原位置', () => {
    const { result } = started(['a', 'b', 'c']);
    act(() => result.current.jumpTo(2)); // 讲到 c
    act(() => result.current.reorder(['b', 'a']));
    expect(result.current.index).toBe(1);
    expect(onFocusNode).toHaveBeenLastCalledWith('a');
  });

  describe('键盘', () => {
    it('→ / ↓ / 空格 / PageDown 都是下一张', () => {
      const { result } = started(['a', 'b', 'c', 'd', 'e']);
      press('ArrowRight');
      press('ArrowDown');
      press(' ');
      press('PageDown');
      expect(result.current.index).toBe(4);
    });

    it('← / ↑ / PageUp 都是上一张', () => {
      const { result } = started();
      act(() => result.current.jumpTo(2));
      press('ArrowLeft');
      press('ArrowUp');
      press('PageUp');
      expect(result.current.index).toBe(0);
    });

    it('Esc 与 End 退出，Home 回第一张', () => {
      const { result } = started();
      act(() => result.current.jumpTo(2));
      press('Home');
      expect(result.current.index).toBe(0);
      expect(result.current.active).toBe(true);

      press('Escape');
      expect(result.current.active).toBe(false);

      const again = started();
      press('End');
      expect(again.result.current.active).toBe(false);
    });

    it('上面压着搜索/对话框层时 Esc 让给它们（不退出、不吞事件），翻页键不受影响', () => {
      const { result } = started();
      const release = acquireKeyboardLayer('search');
      try {
        const event = press('Escape');
        expect(result.current.active).toBe(true);
        expect(event.defaultPrevented).toBe(false);

        press('ArrowRight');
        expect(result.current.index).toBe(1);
      } finally {
        release();
      }
      press('Escape');
      expect(result.current.active).toBe(false);
    });

    it('接管的按键 preventDefault，未接管的按键放行', () => {
      started();
      expect(press('ArrowRight').defaultPrevented).toBe(true);
      expect(press(' ').defaultPrevented).toBe(true);
      expect(press('a').defaultPrevented).toBe(false);
    });

    it('capture 阶段拦截：同一按键不再落到后挂的冒泡监听（如画布快捷键）', () => {
      const bubbleListener = vi.fn();
      window.addEventListener('keydown', bubbleListener);
      try {
        const { result } = started();
        press('ArrowRight');
        expect(result.current.index).toBe(1);
        expect(bubbleListener).not.toHaveBeenCalled();

        press('a'); // 未接管的键正常传播
        expect(bubbleListener).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('keydown', bubbleListener);
      }
    });

    it('焦点在输入框里时不拦：空格是打空格，不是翻页', () => {
      const { result } = started();
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = press(' ', input);
      press('ArrowRight', input);
      press('Escape', input);

      expect(result.current.index).toBe(0);
      expect(result.current.active).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });

    it('焦点在 contentEditable 里时同样放行', () => {
      const { result } = started();
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      document.body.appendChild(editable);

      press('ArrowRight', editable);
      expect(result.current.index).toBe(0);
    });

    it('未激活时不挂监听', () => {
      const { result } = mount();
      press('ArrowRight');
      press('Escape');
      expect(result.current.active).toBe(false);
      expect(onFocusNode).not.toHaveBeenCalled();
    });

    it('exit 之后按键不再响应', () => {
      const { result } = started();
      act(() => result.current.exit());
      expect(press('ArrowRight').defaultPrevented).toBe(false);
    });

    it('卸载后监听被摘掉', () => {
      const { unmount } = started();
      unmount();
      expect(press('ArrowRight').defaultPrevented).toBe(false);
    });
  });
});
