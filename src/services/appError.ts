/**
 * 服务层错误：只带错误码，不带人读文案。
 *
 * 之前服务层直接抛中英混杂的句子（同一个文件里 `'API Key 为空…'` 和
 * `'Network error: …'` 并存），语言跟着代码写死，切到中文界面照样漏英文。
 * 现在服务层只说「出了什么类型的问题」，翻译交给 UI 层的 `resolveErrorMessage`。
 *
 * `Error.message` 仍然填错误码，这样控制台日志与既有的 `formatAiError`
 * 兜底路径都还能打印出可辨识的内容。
 */

export type AppErrorCode =
  // --- 配置类 ---
  | 'ai.no_api_key'
  | 'ai.no_model'
  | 'ai.doubao_needs_endpoint'
  | 'ai.provider_unsupported'
  // --- 传输类 ---
  | 'ai.network'
  | 'ai.http'
  | 'ai.insecure_url'
  | 'ai.response_too_large'
  | 'ai.bad_response'
  | 'ai.no_text'
  // --- 本地 GGUF ---
  | 'ai.local_desktop_only'
  | 'ai.local_no_path'
  | 'ai.local_no_images'
  | 'ai.local_failed'
  | 'ai.local_engine_missing'
  | 'ai.local_gguf_invalid'
  // --- 联网搜索 ---
  | 'search.no_key'
  | 'search.failed'
  // --- 文件 ---
  | 'file.unsupported'
  | 'file.path_not_authorized'
  // --- 本地媒体存储 ---
  | 'media.desktop_only'
  | 'media.command_failed'
  // --- 网页卡片 ---
  | 'web.desktop_only'
  | 'web.fetch_failed';

export class AppError extends Error {
  readonly code: AppErrorCode;
  /**
   * 补充信息：服务商返回的原始报错、HTTP 状态、文件名等。
   * 会以「详情」形式附在本地化文案之后，不参与翻译。
   */
  readonly detail?: string;

  constructor(code: AppErrorCode, detail?: string) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
