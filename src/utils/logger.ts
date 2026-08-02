/**
 * 统一日志出口。
 *
 * 历史上散落着 `[Spoor]` 与 `[Scribe AI]` 两套前缀的裸 `console.*`，
 * 排查问题时既难过滤也难分级。此后一律走这里：
 *
 * - 前缀统一为 `[Spoor:{scope}]`，scope 用模块名（'ai'、'search'、'backup'…），
 *   在 DevTools 里按 `[Spoor:ai]` 过滤即可只看某一模块。
 * - `debug` 只在开发构建输出（`import.meta.env.PROD` 时静默），
 *   其余级别开发与生产一致。
 * - 仍然落到对应的 `console.*` 上：Tauri webview 的控制台与测试里的
 *   console spy 都照常工作。
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function emit(level: LogLevel, scope: string, message: string, detail: unknown[]): void {
  const line = `[Spoor:${scope}] ${message}`;
  const method = level === 'debug' ? 'info' : level;
  if (detail.length > 0) console[method](line, ...detail);
  else console[method](line);
}

export const logger = {
  /** 开发期诊断信息；生产构建里不输出。 */
  debug(scope: string, message: string, ...detail: unknown[]): void {
    if (import.meta.env.PROD) return;
    emit('debug', scope, message, detail);
  },
  info(scope: string, message: string, ...detail: unknown[]): void {
    emit('info', scope, message, detail);
  },
  warn(scope: string, message: string, ...detail: unknown[]): void {
    emit('warn', scope, message, detail);
  },
  error(scope: string, message: string, ...detail: unknown[]): void {
    emit('error', scope, message, detail);
  },
};
