/** True when running inside the Tauri desktop shell (not the browser / Netlify web app). */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
  );
}
