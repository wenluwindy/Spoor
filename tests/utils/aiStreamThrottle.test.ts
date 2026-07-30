import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from '../../src/utils/aiStreamThrottle';

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls immediately on first invoke then batches trailing', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 100);
    t.call('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');

    t.call('ab');
    t.call('abc');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('abc');
  });

  it('flush writes latest without waiting', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 100);
    t.call('x');
    t.call('xy');
    t.flush();
    expect(fn).toHaveBeenLastCalledWith('xy');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel clears pending trailing', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 100);
    t.call('a');
    t.call('b');
    t.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
