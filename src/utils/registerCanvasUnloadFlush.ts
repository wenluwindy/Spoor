import { blurActiveContentEditable } from './commitCanvasInlineEditing';

/** 页面隐藏/关闭前触发当前 contentEditable 失焦，走各节点 onBlur 写库 */
export function registerCanvasUnloadFlush(): () => void {
  const flush = () => blurActiveContentEditable();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  return () => {
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('beforeunload', flush);
  };
}
