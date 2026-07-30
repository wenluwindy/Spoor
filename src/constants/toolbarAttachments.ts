/**
 * 底部输入栏附件的**纯**定义（类型 + accept）。
 *
 * 单独一个模块是为了让 `CanvasToolbar` 不必顺带拖进 `utils/file` → `i18n` 单例：
 * 组件只需要知道附件长什么样、能选什么文件，读文件是 `utils/toolbarAttachments` 的事。
 */

export interface ToolbarAttachment {
  id: string;
  name: string;
  kind: 'image' | 'text';
  /** `kind === 'image'`：data URL，直接交给模型的多模态入参。 */
  dataUrl?: string;
  /** `kind === 'text'`：抽出来的纯文本正文。 */
  text?: string;
}

/**
 * 比画布上传少了 `video/*`：视频没法作为提示词上下文喂给模型。
 * 想把视频放到画布上仍然走右键菜单的「插入视频…」。
 */
export const TOOLBAR_ATTACHMENT_ACCEPT = 'image/*,.docx,.txt,.md';
