import { isTauriRuntime } from './isTauriRuntime';

/**
 * 是否挂载完整应用。
 *
 * 网页版已废弃：本地文件存储、AI 生图、直连模型服务都依赖桌面壳的 Rust 命令与自定义协议，
 * 在浏览器里跑只会半残。构建产物被浏览器打开时改渲染 `DesktopOnlyNotice`。
 *
 * `npm run dev` 需要在浏览器里调试（`tauri:dev` 也是先起这个 dev server），所以 DEV 一并放行。
 */
export function shouldRenderFullApp(): boolean {
  return isTauriRuntime() || import.meta.env.DEV;
}
