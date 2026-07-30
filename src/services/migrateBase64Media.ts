import { db } from '../db';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { mediaImportBytes, type MediaCategory } from './mediaStore';

/**
 * 把早期存成 data URL 的节点搬到文件存储。
 *
 * 没有存量用户（决策 15），这只服务开发期本机造的测试数据，所以刻意做得很轻：
 * **best-effort、静默、不备份、不重试、不显示进度**。失败就原样留着——
 * 渲染层的 `filePath > content` 兜底保证旧数据永远还能显示，不迁移也不会坏。
 *
 * 迁移成功后清掉 `content`，否则 IndexedDB 里那份 base64 白占地方。
 */

/** 一次启动最多搬这么多条，避免开发库里几百张图把启动拖住。剩下的下次启动接着搬。 */
export const MIGRATION_BATCH_LIMIT = 20;

interface ParsedDataUrl {
  bytes: Uint8Array;
  ext: string;
}

/** `data:image/png;base64,iVBOR…` → 字节 + 扩展名。不是 base64 data URL 就返回 null。 */
export function parseDataUrl(value: string): ParsedDataUrl | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim());
  if (!match) return null;

  const mime = match[1].toLowerCase();
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const sub = mime.split('/')[1] ?? '';
  const ext = sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '') || 'bin';
  return { bytes, ext };
}

function categoryForType(type: string): MediaCategory {
  return type === 'document' ? 'documents' : 'uploaded';
}

/**
 * 扫一遍节点，把 `content` 还是 data URL 的搬进文件存储。
 *
 * 返回搬成功的条数，只用于日志。调用方不该据此做任何 UI。
 */
export async function migrateBase64MediaNodes(limit = MIGRATION_BATCH_LIMIT): Promise<number> {
  if (!isTauriRuntime()) return 0;

  const pending = await db.nodes
    .filter((n) => !n.filePath && typeof n.content === 'string' && n.content.startsWith('data:'))
    .limit(limit)
    .toArray();
  if (pending.length === 0) return 0;

  let migrated = 0;
  for (const node of pending) {
    const parsed = parseDataUrl(node.content ?? '');
    if (!parsed) continue;
    try {
      const result = await mediaImportBytes(
        parsed.bytes,
        parsed.ext,
        categoryForType(node.type),
        node.description,
      );
      await db.nodes.update(node.id, {
        filePath: result.rel,
        fileName: node.fileName ?? node.description,
        // 搬完就清 base64，否则 IndexedDB 里还留着一整份
        content: '',
      });
      migrated += 1;
    } catch (e) {
      // 静默：这条下次启动再试，期间靠 content 兜底照常显示
      console.warn('[Spoor] base64 迁移跳过一条', node.id, e);
    }
  }
  return migrated;
}
