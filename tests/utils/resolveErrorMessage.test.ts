import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/services/appError';
import { resolveErrorMessage } from '../../src/utils/resolveErrorMessage';
import i18n from '../../src/i18n';

const t = (key: string) => `[${key}]`;

describe('resolveErrorMessage', () => {
  it('AppError 按错误码取文案', () => {
    expect(resolveErrorMessage(new AppError('ai.no_api_key'), t)).toBe('[errors.ai.no_api_key]');
  });

  it('有 detail 时附在文案之后', () => {
    const msg = resolveErrorMessage(new AppError('ai.http', 'HTTP 429 rate limited'), t);
    expect(msg).toBe('[errors.ai.http]\n\n[errors.detail_label]HTTP 429 rate limited');
  });

  it('detail 为空白时不追加空的详情段', () => {
    expect(resolveErrorMessage(new AppError('ai.http', '   '), t)).toBe('[errors.ai.http]');
  });

  it('非 AppError 原样透出（多为运行时 bug，翻译不了也不该吞）', () => {
    expect(resolveErrorMessage(new Error('boom'), t)).toBe('boom');
    expect(resolveErrorMessage('plain string', t)).toBe('plain string');
  });

  it('每个错误码在 en 与 zh 中都有文案', () => {
    const codes = [
      'ai.no_api_key',
      'ai.no_model',
      'ai.doubao_needs_endpoint',
      'ai.provider_unsupported',
      'ai.network',
      'ai.http',
      'ai.bad_response',
      'ai.no_text',
      'ai.local_desktop_only',
      'ai.local_no_path',
      'ai.local_no_images',
      'ai.local_failed',
      'search.no_key',
      'search.failed',
      'file.unsupported',
      'detail_label',
      'console_hint',
      'check_settings_hint',
    ];
    for (const code of codes) {
      for (const lng of ['en', 'zh']) {
        const key = `errors.${code}`;
        const value = i18n.getFixedT(lng)(key);
        expect(value, `${lng}:${key}`).not.toBe(key);
      }
    }
  });

  it('中文错误文案确实是中文', () => {
    const cjk = /[一-鿿]/;
    for (const code of ['ai.no_api_key', 'ai.network', 'search.failed', 'file.unsupported']) {
      expect(cjk.test(String(i18n.getFixedT('zh')(`errors.${code}`))), code).toBe(true);
    }
  });
});
