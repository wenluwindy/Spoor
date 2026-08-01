import { isTauriRuntime } from './isTauriRuntime';

/**
 * 「让用户挑个位置存下来 / 挑个文件读进来」。
 *
 * 桌面端走系统对话框 + Rust 的 `user_file_*` 命令（见 `src-tauri/src/userfile.rs`）。
 * 浏览器（`npm run dev` 调试）没有那条路，退回 Blob 下载与隐藏的 `<input type="file">`——
 * 功能上够用，只是存到哪由浏览器的下载目录说了算。
 *
 * 与 `utils/filePicker` 的分工：那个负责**把文件导入画布**（大二进制不进 JS，Rust 直接
 * copy）；这里负责**小体积文本的进出**（`.canvas`、备份 JSON），内容本来就要在 JS 里
 * 生成或解析，走 IPC 传字符串是合适的。
 */

export interface TextFileFilter {
  name: string;
  extensions: string[];
}

async function callTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function downloadInBrowser(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * 存一份文本。
 *
 * @returns 是否真的写下去了（用户在对话框里取消也返回 false）
 */
export async function saveTextFile(
  defaultFileName: string,
  contents: string,
  filters: TextFileFilter[] = [],
): Promise<boolean> {
  if (!isTauriRuntime()) {
    downloadInBrowser(defaultFileName, contents);
    return true;
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const dest = await save({ defaultPath: defaultFileName, filters });
  if (!dest) return false;
  await callTauri('user_file_write_text', { destPath: dest, contents });
  return true;
}

export interface OpenedTextFile {
  fileName: string;
  text: string;
}

function readViaInput(accept: string): Promise<OpenedTextFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        void file.text().then((text) => resolve({ fileName: file.name, text }));
      },
      { once: true },
    );

    input.click();
  });
}

/** 让用户挑一个文本文件读进来。取消时返回 null。 */
export async function openTextFile(
  filters: TextFileFilter[] = [],
  browserAccept = '',
): Promise<OpenedTextFile | null> {
  if (!isTauriRuntime()) return readViaInput(browserAccept);

  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: false, filters });
  if (typeof picked !== 'string') return null;
  const text = await callTauri<string>('user_file_read_text', { srcPath: picked });
  return { fileName: picked.split(/[\\/]/).pop() ?? picked, text };
}
