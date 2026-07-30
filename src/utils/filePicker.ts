/**
 * 唤起系统文件选择框。
 *
 * 临时用隐藏的 `<input type="file">`：拿到的是 `File` 对象而非路径，大文件会整段读进内存。
 * v0.3.0 的 S20 会换成 `tauri-plugin-dialog` 的 `open()`（返回绝对路径，由 Rust 直接复制），
 * 届时本文件整体退役。接口刻意保持 `Promise<File[]>` 以外的调用方零感知。
 */

/** 用户取消时不会触发 change；窗口重新获得焦点后再等这么久仍无 change 就按取消处理。 */
const CANCEL_GRACE_MS = 400;

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);

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
      resolve(files);
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
