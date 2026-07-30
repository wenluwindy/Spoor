import { isTauriRuntime } from './isTauriRuntime';

/**
 * 唤起系统文件选择框。
 *
 * 桌面端走 `tauri-plugin-dialog`，拿到的是**绝对路径**——Rust 侧直接 `fs::copy`
 * 入库，文件字节一个字节都不进 JS。浏览器（`npm run dev` 调试）没有这条路，
 * 退回隐藏的 `<input type="file">`，拿 `File` 对象。
 *
 * 两种结果形状不同，用 [`PickedFiles`] 的判别联合表达，调用方必须显式分支：
 * 把它们抹平成同一种就等于把「大文件不进内存」这个收益抹掉了。
 */

export type PickedFiles =
  | { kind: 'paths'; paths: string[] }
  | { kind: 'files'; files: File[] };

/** 用户取消时不会触发 change；窗口重新获得焦点后再等这么久仍无 change 就按取消处理。 */
const CANCEL_GRACE_MS = 400;

/** `accept="image/*,.docx"` → 对话框要的 `[{ name, extensions: ['png', …] }]`。 */
export function acceptToDialogFilters(accept: string): { name: string; extensions: string[] }[] {
  const exts = new Set<string>();
  for (const raw of accept.split(',')) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item === 'image/*') ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].forEach((e) => exts.add(e));
    else if (item === 'video/*') ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].forEach((e) => exts.add(e));
    else if (item.startsWith('.')) exts.add(item.slice(1));
    else if (item.includes('/')) {
      // `text/markdown` 这类具体 MIME：取子类型当扩展名，够用
      const sub = item.split('/')[1];
      if (sub && sub !== '*') exts.add(sub);
    }
  }
  return exts.size > 0 ? [{ name: 'files', extensions: [...exts] }] : [];
}

function pickViaInput(accept: string, multiple: boolean): Promise<PickedFiles> {
  if (typeof document === 'undefined') return Promise.resolve({ kind: 'files', files: [] });

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    let cancelTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      window.removeEventListener('focus', onWindowFocus);
      if (cancelTimer !== null) clearTimeout(cancelTimer);
      input.remove();
    };

    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ kind: 'files', files });
    };

    const onWindowFocus = () => {
      // change 会在 focus 之后才派发，所以留一小段宽限期再判定为取消。
      cancelTimer = setTimeout(() => settle([]), CANCEL_GRACE_MS);
    };

    input.addEventListener(
      'change',
      () => settle(input.files ? Array.from(input.files) : []),
      { once: true },
    );
    window.addEventListener('focus', onWindowFocus);

    input.click();
  });
}

export async function pickFiles(accept: string, multiple = true): Promise<PickedFiles> {
  if (!isTauriRuntime()) return pickViaInput(accept, multiple);

  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple, filters: acceptToDialogFilters(accept) });
    if (selected == null) return { kind: 'paths', paths: [] };
    return { kind: 'paths', paths: Array.isArray(selected) ? selected : [selected] };
  } catch (e) {
    // 插件没装好/权限没配时不该让「插入图片」整个失效，退回 input 仍能用
    console.error('[Spoor] native file dialog failed, falling back to <input>', e);
    return pickViaInput(accept, multiple);
  }
}
