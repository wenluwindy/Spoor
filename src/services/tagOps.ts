/**
 * 标签的批量管理：重命名 / 合并 / 删除（B6）。
 *
 * 都是「改**这张画布**上所有带该标签的节点」的批量写。两条规矩：
 *
 * 1. **写库走可撤销通道** `updateNodeRecorded`，整批共用一把 `tags:${uuid}` 合并键
 *    （与 App 的 setNodeTags 同一套模式）——重命名波及二十张卡也只算**一步**撤销，
 *    Ctrl+Z 一次全部回来。
 * 2. 合并就是「重命名到一个已存在的标签」：某张卡两个标签都有时用 Set 去重，
 *    不会出现 `['a', 'a']`。
 *
 * 写完顺手同步 `tagFilter` 的点亮状态：正在按旧名筛选时，改名后筛选跟着改名，
 * 而不是残留一个已不存在的标签把整张画布筛成空。
 */

import { db, type CanvasNode } from '../db';
import { updateNodeRecorded } from './canvasMutations';
import { removeActiveTag, renameActiveTag } from './tagFilter';

/** 该画布上带指定标签的所有节点。canvasId 走索引，标签在行内过滤。 */
function nodesWithTag(canvasId: string, tag: string): Promise<CanvasNode[]> {
  return db.nodes
    .where('canvasId')
    .equals(canvasId)
    .filter((n) => (n.tags ?? []).includes(tag))
    .toArray();
}

/** 整批共用一把新钥匙：同批合并成一步，两次独立操作不会被误并。 */
function newCoalesceKey(): string {
  return `tags:${crypto.randomUUID()}`;
}

/**
 * 把 `from` 改名为 `to`；`to` 已存在时即为合并（去重）。
 * 返回改动的节点数。`to` 为空或与 `from` 相同时不写库也不入撤销栈。
 */
export async function renameTag(canvasId: string, from: string, to: string): Promise<number> {
  const target = to.trim();
  if (target === '' || target === from) return 0;

  const rows = await nodesWithTag(canvasId, from);
  if (rows.length === 0) return 0;

  const coalesceKey = newCoalesceKey();
  for (const row of rows) {
    const next = [...new Set((row.tags ?? []).map((t) => (t === from ? target : t)))];
    await updateNodeRecorded(canvasId, row.id, { tags: next }, { coalesceKey });
  }
  renameActiveTag(from, target);
  return rows.length;
}

/**
 * 从该画布所有节点上摘掉这个标签。摘光了就把 `tags` 置回 undefined
 * （与 App 的 setNodeTags 清空行为一致，不留空数组）。返回改动的节点数。
 */
export async function deleteTag(canvasId: string, tag: string): Promise<number> {
  const rows = await nodesWithTag(canvasId, tag);
  if (rows.length === 0) {
    removeActiveTag(tag);
    return 0;
  }

  const coalesceKey = newCoalesceKey();
  for (const row of rows) {
    const next = (row.tags ?? []).filter((t) => t !== tag);
    await updateNodeRecorded(
      canvasId,
      row.id,
      { tags: next.length > 0 ? next : undefined },
      { coalesceKey },
    );
  }
  removeActiveTag(tag);
  return rows.length;
}
