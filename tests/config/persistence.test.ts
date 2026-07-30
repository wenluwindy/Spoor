import { describe, it, expect, beforeEach } from 'vitest';
import {
  isContentBlurPersistenceDisabled,
  DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT,
} from '../../src/config/persistence';

describe('isContentBlurPersistenceDisabled', () => {
  beforeEach(() => {
    localStorage.removeItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE');
  });

  it('localStorage SCRIBE_DISABLE_CONTENT_AUTOSAVE=0 overrides project default and enables blur saves', () => {
    localStorage.setItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE', '0');
    expect(isContentBlurPersistenceDisabled()).toBe(false);
  });

  it('without override key, matches DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT', () => {
    expect(isContentBlurPersistenceDisabled()).toBe(DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT);
  });
});
