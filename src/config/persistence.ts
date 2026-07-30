/**
 * Blur persistence: note/article text written to IndexedDB when a field loses focus.
 *
 * `DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT`: when `true`, blur autosave is disabled project-wide (unless overridden below).
 * To enable when project default is off: `localStorage.setItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE','0')` then reload.
 * To disable when project default allows saves: `localStorage.setItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE','1')`.
 *
 * Alternatively use `VITE_DISABLE_CONTENT_AUTOSAVE=true` in `.env` when the project default is “allow saves”.
 */
export const DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT = false;

export function isContentBlurPersistenceDisabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE') === '0') {
      return false;
    }
  } catch {
    // ignore
  }
  if (DISABLE_CONTENT_BLUR_PERSISTENCE_PROJECT) return true;
  if (import.meta.env.VITE_DISABLE_CONTENT_AUTOSAVE === 'true') return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('SCRIBE_DISABLE_CONTENT_AUTOSAVE') === '1';
  } catch {
    return false;
  }
}
