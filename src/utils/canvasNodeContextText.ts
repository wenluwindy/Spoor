/** 挂载在节点内「仅用户内容」根元素上；Agent / 合成等从 DOM 取文优先读此区域，避免便签/主题卡 UI 标签进入模型上下文 */
export const CANVAS_NODE_CONTEXT_TEXT_ATTR = 'data-canvas-node-context-text';

export function getCanvasNodeContextText(root: HTMLElement): string {
  const scoped = root.querySelector(`[${CANVAS_NODE_CONTEXT_TEXT_ATTR}]`) as HTMLElement | null;
  if (scoped) {
    const text = (scoped.innerText || scoped.textContent || '').trim();
    if (text) return text;
  }
  return (root.innerText || root.textContent || '').trim();
}
