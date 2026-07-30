import { isAppError } from '../services/appError';
import { formatAiError } from '../services/ai';

type TranslateFn = (key: string) => string;

/**
 * 把服务层抛出的错误翻成给用户看的一句话。
 *
 * - `AppError` → 按错误码取本地化文案，`detail` 以「详情」附在后面。
 * - 其他异常 → 原样透出（多为运行时 bug 或第三方 SDK 的报错，翻译不了也不该吞掉）。
 */
export function resolveErrorMessage(e: unknown, t: TranslateFn): string {
  if (!isAppError(e)) return formatAiError(e);

  const message = t(`errors.${e.code}`);
  const detail = e.detail?.trim();
  if (!detail) return message;
  return `${message}\n\n${t('errors.detail_label')}${detail}`;
}
