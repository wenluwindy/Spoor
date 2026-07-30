/**
 * MiMo「Token 套餐」专属 API（控制台里 tp- 密钥对应的 OpenAI 兼容 Base URL）。
 * 勿与通用域名 api.xiaomimimo.com 混用，否则易 401 invalid_key。
 */
export const MIMO_TOKEN_PLAN_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';

/** Hosted MiMo quota expiry — shown in Settings when a built-in key is baked in. */
export const BUILTIN_MIMO_API_EXPIRES_AT = '2026-06-01';

/**
 * Optional hosted MiMo key baked in at build time (Vite: VITE_BUILTIN_MIMO_API_KEY).
 * WARNING: visible in the shipped JS bundle — only for low-friction demos; rotate if leaked.
 */
export function getBuiltinMimoApiKey(): string {
  const raw = import.meta.env.VITE_BUILTIN_MIMO_API_KEY;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function hasBuiltinMimoApiKey(): boolean {
  return getBuiltinMimoApiKey().length > 0;
}

/** User key wins; otherwise built-in key when configured. */
export function resolveMimoApiKey(userKey?: string): string {
  const user = (userKey ?? '').trim();
  if (user) return user;
  return getBuiltinMimoApiKey();
}
