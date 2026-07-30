import { describe, it, expect } from 'vitest';
import {
  shouldPreflightToolbarIntent,
  TOOLBAR_INTENT_SHORT_MAX_CHARS,
} from '../../src/utils/toolbarIntentGate';

describe('shouldPreflightToolbarIntent', () => {
  it('returns false for empty', () => {
    expect(shouldPreflightToolbarIntent('')).toBe(false);
    expect(shouldPreflightToolbarIntent('   ')).toBe(false);
  });

  it('returns true for question mark', () => {
    expect(shouldPreflightToolbarIntent('What is memory?')).toBe(true);
    expect(shouldPreflightToolbarIntent('这是什么？')).toBe(true);
  });

  it('returns true for short text at or below threshold', () => {
    const short = 'a'.repeat(TOOLBAR_INTENT_SHORT_MAX_CHARS);
    expect(shouldPreflightToolbarIntent(short)).toBe(true);
    expect(shouldPreflightToolbarIntent('hi')).toBe(true);
  });

  it('returns false for long text without triggers', () => {
    const long = 'a'.repeat(TOOLBAR_INTENT_SHORT_MAX_CHARS + 5);
    expect(shouldPreflightToolbarIntent(long)).toBe(false);
  });

  it('returns true for multi-part with semicolons even when long', () => {
    const s = `${'word '.repeat(30)}；${'other '.repeat(30)}`;
    expect(s.length).toBeGreaterThan(TOOLBAR_INTENT_SHORT_MAX_CHARS);
    expect(shouldPreflightToolbarIntent(s)).toBe(true);
  });

  it('returns true for two non-empty lines', () => {
    expect(shouldPreflightToolbarIntent('line one\nline two')).toBe(true);
  });

  it('returns true for two numbered items', () => {
    expect(shouldPreflightToolbarIntent('1. first task\n2. second task')).toBe(true);
  });
});
