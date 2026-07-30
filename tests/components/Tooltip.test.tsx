import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Tooltip, TOOLTIP_DELAY_MS } from '../../src/components/ui/Tooltip';

/** jsdom 不做布局，getBoundingClientRect 恒为 0；按需给触发元素与提示框各喂一个矩形。 */
function stubRects(anchor: Partial<DOMRect>, tip: Partial<DOMRect> = { width: 100, height: 24 }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = this.hasAttribute('data-tooltip') ? tip : anchor;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
      ...box,
    } as DOMRect;
  });
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('悬停未满延迟不弹出，满 400ms 后弹出', () => {
    render(
      <Tooltip label="删除便签">
        <button type="button">x</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');

    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('删除便签');
  });

  it('移开指针立即收起', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');

    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('未到延迟就移开则不会弹出', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');

    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerLeave(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('按下时立即收起（避免点击后提示悬着）', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');

    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    fireEvent.pointerDown(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('键盘聚焦也会弹出', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('保留子元素自己的事件处理器', () => {
    const onPointerEnter = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <Tooltip label="提示">
        <button type="button" onPointerEnter={onPointerEnter} onPointerDown={onPointerDown}>
          x
        </button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');

    fireEvent.pointerEnter(btn);
    fireEvent.pointerDown(btn);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('保留子元素自己的 ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Tooltip label="提示">
        <button type="button" ref={ref}>
          x
        </button>
      </Tooltip>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('写入 aria-label，但不覆盖子元素已有的', () => {
    const { rerender } = render(
      <Tooltip label="删除便签">
        <button type="button" />
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '删除便签');

    rerender(
      <Tooltip label="删除便签">
        <button type="button" aria-label="自定义" />
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '自定义');
  });

  it('skipAriaLabel 时不写 aria-label（子元素已有可见文字）', () => {
    render(
      <Tooltip label="提示" skipAriaLabel>
        <button type="button">保存</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-label');
  });

  it('disabled 或空 label 时既不弹出也不写 aria-label', () => {
    const { rerender } = render(
      <Tooltip label="提示" disabled>
        <button type="button">x</button>
      </Tooltip>,
    );
    let btn = screen.getByRole('button');
    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(btn).not.toHaveAttribute('aria-label');

    rerender(
      <Tooltip label="   ">
        <button type="button">x</button>
      </Tooltip>,
    );
    btn = screen.getByRole('button');
    fireEvent.pointerEnter(btn);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('渲染到 body 而非触发元素内部（避免被画布 transform 缩放）', () => {
    const { container } = render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });

    const tip = screen.getByRole('tooltip');
    expect(container.contains(tip)).toBe(false);
    expect(document.body.contains(tip)).toBe(true);
    expect(tip).toHaveClass('fixed');
  });

  describe('定位', () => {
    it('上方空间足够时摆在上方', () => {
      stubRects({ top: 300, bottom: 320, left: 400, width: 20, height: 20 });
      render(
        <Tooltip label="提示">
          <button type="button">x</button>
        </Tooltip>,
      );
      fireEvent.pointerEnter(screen.getByRole('button'));
      act(() => {
        vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      });

      const tip = screen.getByRole('tooltip');
      expect(tip).toHaveAttribute('data-placement', 'top');
      // 300 - 24(高) - 8(间距) = 268；水平居中 410 - 50 = 360
      expect(tip.style.top).toBe('268px');
      expect(tip.style.left).toBe('360px');
    });

    it('贴近视口顶部时翻转到下方', () => {
      stubRects({ top: 4, bottom: 24, left: 400, width: 20, height: 20 });
      render(
        <Tooltip label="提示">
          <button type="button">x</button>
        </Tooltip>,
      );
      fireEvent.pointerEnter(screen.getByRole('button'));
      act(() => {
        vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      });

      const tip = screen.getByRole('tooltip');
      expect(tip).toHaveAttribute('data-placement', 'bottom');
      expect(tip.style.top).toBe('32px');
    });

    it('贴近视口右缘时向内收，不溢出', () => {
      // jsdom innerWidth = 1024
      stubRects({ top: 300, bottom: 320, left: 1010, width: 20, height: 20 });
      render(
        <Tooltip label="提示">
          <button type="button">x</button>
        </Tooltip>,
      );
      fireEvent.pointerEnter(screen.getByRole('button'));
      act(() => {
        vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      });

      const tip = screen.getByRole('tooltip');
      // 1024 - 100(宽) - 8(边距) = 916
      expect(tip.style.left).toBe('916px');
    });
  });

  it('画布滚轮缩放/平移时收起，避免停在错误位置', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('按 Escape 收起', () => {
    render(
      <Tooltip label="提示">
        <button type="button">x</button>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
