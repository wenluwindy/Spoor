import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBuiltinMimoApiKey,
  hasBuiltinMimoApiKey,
  resolveMimoApiKey,
} from '../../src/constants/mimo';

describe('mimo builtin API key', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolveMimoApiKey prefers user key over builtin', () => {
    vi.stubEnv('VITE_BUILTIN_MIMO_API_KEY', 'tp-builtin');
    expect(resolveMimoApiKey('tp-user')).toBe('tp-user');
  });

  it('resolveMimoApiKey falls back to builtin when user empty', () => {
    vi.stubEnv('VITE_BUILTIN_MIMO_API_KEY', 'tp-builtin');
    expect(resolveMimoApiKey('')).toBe('tp-builtin');
    expect(resolveMimoApiKey('   ')).toBe('tp-builtin');
  });

  it('hasBuiltinMimoApiKey is false when env unset', () => {
    vi.stubEnv('VITE_BUILTIN_MIMO_API_KEY', '');
    expect(getBuiltinMimoApiKey()).toBe('');
    expect(hasBuiltinMimoApiKey()).toBe(false);
    expect(resolveMimoApiKey('')).toBe('');
  });
});
