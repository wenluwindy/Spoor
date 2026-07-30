import mammoth from 'mammoth';
import { AppError } from './appError';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { mediaImport, mediaImportBytes, type MediaCategory } from './mediaStore';
import { mediaUrl } from '../utils/mediaUrl';

/**
 * 文件导入：原件一律归档到文件存储，数据库只留相对路径 + 需要检索的正文。
 *
 * 两条入口，落到同一个 [`FileNodeData`]：
 * - [`importPathToNodeData`] —— 原生文件对话框/拖放给的**绝对路径**，Rust 直接 `fs::copy`，
 *   500MB 的视频也不过 IPC。桌面端优先走这条。
 * - [`importFileToNodeData`] —— 只有 `File` 对象时（剪贴板粘贴、浏览器调试）走字节流。
 *
 * 正文（docx 转出的 HTML、txt/md 原文）仍然入库：搜索、AI 上下文、长文合成都要读它，
 * 每次都去解一遍 docx 不现实。原件同时归档，是为了「另存为」和日后重新解析。
 */

export interface FileNodeData {
  type: string;
  /** 数据根内的相对路径。 */
  filePath: string;
  /** 原始文件名。 */
  fileName: string;
  /** 正文：docx → HTML；txt/md → 纯文本；二进制类型没有。 */
  content?: string;
  /** 节点上显示的说明，沿用文件名。 */
  description?: string;
  fileType: string;
}

/** 归入哪一类目录。文档单独放，方便资产管理器按类筛。 */
function categoryFor(kind: string): MediaCategory {
  return kind === 'document' || kind === 'text' ? 'documents' : 'uploaded';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

/**
 * 按文件名 + MIME 判断节点类型。
 *
 * 先看扩展名再看 MIME：原生路径入口拿不到 MIME，而 Windows 上不少文件的
 * MIME 嗅探也不可靠（docx 常被报成 `application/zip`）。
 */
export function classifyFile(name: string, mime = ''): {
  kind: 'image' | 'video' | 'document' | 'text' | 'file';
  fileType: string;
} {
  const ext = extensionOf(name).toLowerCase();

  if (ext === 'docx') return { kind: 'document', fileType: 'docx' };
  if (ext === 'txt') return { kind: 'text', fileType: 'text/plain' };
  if (ext === 'md' || ext === 'markdown') return { kind: 'text', fileType: 'text/markdown' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) {
    return { kind: 'image', fileType: mime || `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  }
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) {
    return { kind: 'video', fileType: mime || `video/${ext}` };
  }

  if (mime.startsWith('image/')) return { kind: 'image', fileType: mime };
  if (mime.startsWith('video/')) return { kind: 'video', fileType: mime };
  if (mime === 'text/plain') return { kind: 'text', fileType: mime };
  if (mime === 'text/markdown') return { kind: 'text', fileType: mime };
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { kind: 'document', fileType: 'docx' };
  }

  // 认不出来的也收下：落成通用 file 节点，至少留住原件
  return { kind: 'file', fileType: mime || ext || 'application/octet-stream' };
}

/** 从已入库的文件里取正文。走 spoor-media 协议读回来，省一条 Rust 命令。 */
async function readBodyFromStore(rel: string, kind: string, emptyFallback: string): Promise<string> {
  const res = await fetch(mediaUrl(rel));
  if (!res.ok) throw new AppError('media.command_failed', `read body ${res.status}`);

  if (kind === 'document') {
    const arrayBuffer = await res.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return result.value || emptyFallback;
  }
  return res.text();
}

function nodeTypeFor(kind: string): string {
  // 便签和 txt/md 共用 `text` 节点，与历史行为一致
  return kind === 'text' ? 'text' : kind;
}

async function buildNodeData(
  rel: string,
  fileName: string,
  kind: ReturnType<typeof classifyFile>['kind'],
  fileType: string,
  emptyDocumentBody: string,
): Promise<FileNodeData> {
  const base: FileNodeData = {
    type: nodeTypeFor(kind),
    filePath: rel,
    fileName,
    fileType,
    description: fileName,
  };

  if (kind === 'document' || kind === 'text') {
    base.content = await readBodyFromStore(rel, kind, emptyDocumentBody);
  }
  return base;
}

/**
 * 从原生绝对路径导入（文件对话框 / 原生拖放）。
 *
 * `emptyDocumentBody` 由调用方传入本地化文案——服务层不碰 i18n 单例，
 * 否则任何 import 它的测试都要一并 mock react-i18next。
 */
export async function importPathToNodeData(
  srcPath: string,
  emptyDocumentBody: string,
): Promise<FileNodeData> {
  const fileName = srcPath.split(/[\\/]/).pop() || 'file';
  const { kind, fileType } = classifyFile(fileName);
  const result = await mediaImport(srcPath, categoryFor(kind));
  return buildNodeData(result.rel, result.fileName || fileName, kind, fileType, emptyDocumentBody);
}

/**
 * 从 `File` 对象导入（剪贴板粘贴、浏览器调试）。
 *
 * 会把整个文件读进内存再过一次 IPC，大文件很吃亏——有绝对路径时一律走
 * [`importPathToNodeData`]。
 */
export async function importFileToNodeData(
  file: File,
  emptyDocumentBody: string,
): Promise<FileNodeData> {
  if (!isTauriRuntime()) throw new AppError('media.desktop_only', file.name);

  const { kind, fileType } = classifyFile(file.name, file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await mediaImportBytes(
    bytes,
    extensionOf(file.name) || 'bin',
    categoryFor(kind),
    file.name,
  );
  return buildNodeData(result.rel, file.name, kind, fileType, emptyDocumentBody);
}
