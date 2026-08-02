import i18n from '../i18n';
import { readFileToContentData } from '../services/fileImport';
import { AppError } from '../services/appError';
import type { ToolbarAttachment } from '../constants/toolbarAttachments';

/**
 * 底部输入栏附件的读取与拼装。类型与 accept 见 `constants/toolbarAttachments`。
 *
 * 与画布上的文件节点是两回事：这里的文件**不落画布**，只作为这一次提问的上下文——
 * 图片走多模态入参，文档抽成正文拼进提示词。发送完即清空。
 */

/** docx 经 mammoth 转成 HTML，喂给模型前拆掉标签，只留正文与换行。 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fileToToolbarAttachment(file: File): Promise<ToolbarAttachment> {
  const data = await readFileToContentData(file, i18n.t('nodes.empty_document_body'));
  const id = crypto.randomUUID();

  if (data.type === 'image') {
    return { id, name: file.name, kind: 'image', dataUrl: data.content };
  }
  if (data.type === 'document') {
    return { id, name: file.name, kind: 'text', text: htmlToPlainText(data.content) };
  }
  if (data.type === 'text') {
    return { id, name: file.name, kind: 'text', text: data.content };
  }
  // 视频等：readFileToContentData 认得，但当不了提示词上下文
  throw new AppError('file.unsupported', file.type || file.name);
}

export function collectAttachmentImages(attachments: ToolbarAttachment[]): string[] {
  return attachments
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => a.dataUrl as string);
}

/**
 * 文档附件拼成一段带文件名的上下文。没有文本附件时返回空串，
 * 调用方据此决定要不要往提示词里加这一段。
 */
export function buildAttachmentContextText(
  attachments: ToolbarAttachment[],
  fileLabel: (name: string) => string,
): string {
  const parts = attachments
    .filter((a) => a.kind === 'text' && a.text?.trim())
    .map((a) => `${fileLabel(a.name)}\n${a.text!.trim()}`);
  return parts.join('\n\n');
}
