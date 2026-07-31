import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  beginGroupDrag,
  endGroupDrag,
  getGroupDragLeaderId,
  publishGroupDelta,
  resetGroupDragForTests,
  subscribeGroupDrag,
  type GroupDragEvent,
} from '../../src/services/canvasGroupDrag';

describe('canvasGroupDrag', () => {
  beforeEach(() => {
    resetGroupDragForTests();
  });

  it('按 begin → delta → end 的顺序广播', () => {
    const seen: GroupDragEvent[] = [];
    subscribeGroupDrag((e) => seen.push(e));

    beginGroupDrag('a', ['a', 'b']);
    publishGroupDelta('a', 24, 48);
    endGroupDrag('a');

    expect(seen).toEqual([
      { type: 'begin', leaderId: 'a', ids: ['a', 'b'] },
      { type: 'delta', leaderId: 'a', dx: 24, dy: 48 },
      { type: 'end', leaderId: 'a' },
    ]);
  });

  it('非当前 leader 的位移被忽略——防止两个指针互相打架', () => {
    const listener = vi.fn();
    beginGroupDrag('a', ['a', 'b']);
    subscribeGroupDrag(listener);

    publishGroupDelta('b', 10, 10);

    expect(listener).not.toHaveBeenCalled();
  });

  it('非当前 leader 结束不了别人的拖拽', () => {
    beginGroupDrag('a', ['a', 'b']);
    endGroupDrag('b');
    expect(getGroupDragLeaderId()).toBe('a');

    endGroupDrag('a');
    expect(getGroupDragLeaderId()).toBeNull();
  });

  it('结束后再发位移不再广播', () => {
    beginGroupDrag('a', ['a', 'b']);
    endGroupDrag('a');

    const listener = vi.fn();
    subscribeGroupDrag(listener);
    publishGroupDelta('a', 5, 5);

    expect(listener).not.toHaveBeenCalled();
  });

  it('退订后收不到事件', () => {
    const listener = vi.fn();
    subscribeGroupDrag(listener)();
    beginGroupDrag('a', ['a']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('多个订阅者都收到同一份事件', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeGroupDrag(a);
    subscribeGroupDrag(b);

    beginGroupDrag('leader', ['leader', 'x']);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
