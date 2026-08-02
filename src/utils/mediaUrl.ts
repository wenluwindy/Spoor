/**
 * 数据库里的相对路径 → webview 能加载的 URL。
 *
 * 走 Rust 注册的 `spoor-media` 自定义协议（见 `src-tauri/src/media.rs`），
 * 不用 `convertFileSrc`——那是 `asset` 协议专用，而 asset 协议要静态 scope，
 * 数据根却是运行时解析的（安装目录不可写时会回退），对不上。
 */

/**
 * 自定义协议的源按平台拼：Windows 的 WebView2 把自定义协议映射成
 * `http://<scheme>.localhost/`，macOS / Linux（WKWebView / WebKitGTK）保持
 * `<scheme>://localhost/` 原样。以前硬编码 Windows 形式，macOS 包会加载不到本地媒体。
 *
 * 用 UA 判平台就够了：桌面 webview 的 UA 一定带 `Windows NT` / `Macintosh` 等标记，
 * 而这个 URL 只在 Tauri webview 里被消费（浏览器调试时媒体协议本来就不可用）。
 * 参数只为测试注入，业务代码不要传。
 */
export function mediaOrigin(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): string {
  return /windows/i.test(userAgent)
    ? 'http://spoor-media.localhost'
    : 'spoor-media://localhost';
}

/**
 * 节点渲染统一走这里：优先 `filePath`（文件存储），回退 `content`（旧的 data URL）。
 *
 * 保留 data URL 兜底的成本极低，换来的是开发期造的旧数据永远还能显示。
 */
export function resolveNodeMediaSrc(node: {
  filePath?: string;
  content?: string;
}): string | undefined {
  if (node.filePath) return mediaUrl(node.filePath);
  return node.content || undefined;
}

/**
 * 相对路径转 URL。逐段 encode——文件名可能带空格、中文、`#`、`?`，
 * 整串 encode 会把分隔符 `/` 也编掉。
 */
export function mediaUrl(relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, '');
  const encoded = cleaned.split('/').map(encodeURIComponent).join('/');
  return `${mediaOrigin()}/${encoded}`;
}
