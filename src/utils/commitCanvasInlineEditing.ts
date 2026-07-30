import type { MutableRefObject } from 'react';

/**
 * 在画布空白处平移等操作前调用：因为 useCanvasInteraction.handlePanStart 会 preventDefault，
 * 浏览器不会自动把焦点从 contentEditable 转走、也就不会触发 onBlur。
 *
 * 这里的职责是 **触发 blur**，让受控的 onBlur 走完整链路（写库 + 清 editingNodeId）。
 * 不直接调 db.nodes.update，也不直接 setEditingNodeId(null)，避免双写库或绕过组件状态。
 */
export function commitCanvasInlineEditing(params: {
  editingNodeId: string | null;
  nodesRef: MutableRefObject<Record<string, HTMLElement | null>>;
  nodeType: string | undefined;
}): void {
  const { editingNodeId, nodesRef, nodeType } = params;

  if (editingNodeId && (nodeType === 'note' || nodeType === 'text')) {
    const root = nodesRef.current[editingNodeId];
    const ce = root?.querySelector('[contenteditable="true"]') as HTMLElement | null;
    if (ce) {
      ce.blur();
      return;
    }
  }

  /** 主题卡等始终 contentEditable、不设 editingNodeId 的节点，靠焦点元素 blur 触发 onBlur 写库 */
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && ae.isContentEditable) {
    ae.blur();
  }
}

/** 刷新/关闭页面前调用：让当前焦点上的 contentEditable 先失焦写库 */
export function blurActiveContentEditable(): void {
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && ae.isContentEditable) {
    ae.blur();
  }
}
