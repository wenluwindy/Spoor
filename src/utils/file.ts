import mammoth from 'mammoth';
import i18n from '../i18n';
import { AppError } from '../services/appError';

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * 把文件整个读进内存的结果。
 *
 * **只给输入栏附件与浏览器调试兜底用**：画布节点走 `services/fileImport`，
 * 原件落文件存储、数据库只留相对路径。这里的 data URL 进数据库会把
 * IndexedDB 撑爆——那正是 v0.3.0 要改掉的。
 */
export interface FileContentData {
  type: string;
  content: string;
  description?: string;
  fileType: string;
}

export async function readFileContent(file: File): Promise<FileContentData> {
  if (file.type.startsWith('video/')) {
    return {
      type: 'video',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return {
      type: 'document',
      content: result.value || `<p>${i18n.t('nodes.empty_document_body')}</p>`,
      description: file.name,
      fileType: 'docx',
    };
  }

  if (file.name.endsWith('.txt') || file.type === 'text/plain') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/plain',
    };
  }

  if (file.name.endsWith('.md') || file.type === 'text/markdown') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/markdown',
    };
  }

  throw new AppError('file.unsupported', file.type || file.name);
}
