import { isTauriRuntime } from './isTauriRuntime';

/** Open URL in system browser (Tauri) or new tab (browser dev). */
export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    console.warn('[Spoor] openExternalUrl skipped non-http(s) URL');
    return;
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url: trimmed });
    return;
  }

  window.open(trimmed, '_blank', 'noopener,noreferrer');
}
