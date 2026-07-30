import { describe, it, expect } from 'vitest';
import { isDarkNodeBackground } from '../../src/utils/nodePaletteTone';

describe('isDarkNodeBackground', () => {
  it('treats pitch black and slate as dark', () => {
    expect(isDarkNodeBackground('#1a1a1a')).toBe(true);
    expect(isDarkNodeBackground('#1e293b')).toBe(true);
  });

  it('treats white, paper, and amber as light', () => {
    expect(isDarkNodeBackground('#ffffff')).toBe(false);
    expect(isDarkNodeBackground('#F4F1ED')).toBe(false);
    expect(isDarkNodeBackground('#fef3c7')).toBe(false);
  });

  it('treats accent ochre as dark for chrome contrast', () => {
    expect(isDarkNodeBackground('#C2410C')).toBe(true);
  });

  it('accepts optional leading hash', () => {
    expect(isDarkNodeBackground('1a1a1a')).toBe(true);
  });

  it('returns false for invalid input', () => {
    expect(isDarkNodeBackground('')).toBe(false);
    expect(isDarkNodeBackground('red')).toBe(false);
  });
});
