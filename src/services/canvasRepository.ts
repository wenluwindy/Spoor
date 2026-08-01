import { db } from '../db';
import { clearCanvasHistory } from './canvasHistory';

/**
 * 画布本身的增删。节点/连线的增删见 `hooks/useNodeActions`。
 */

/** 旧数据里没有 `canvasId` 的节点与连线一律归属 `'default'`（见 App 的 useLiveQuery 过滤）。 */
function belongsToCanvas(owner: string | undefined, canvasId: string): boolean {
  return owner === canvasId || (!owner && canvasId === 'default');
}

/**
 * 删除画布，连同它的节点、连线，以及长文里指向它的引用。
 *
 * 不做「最后一张画布」的判断——那是 UI 的事（`CanvasHistoryPopover` 会禁用按钮），
 * 这里只负责把该画布的痕迹清干净。
 */
export async function deleteCanvasWithContents(canvasId: string): Promise<void> {
  const nodes = await db.nodes.filter((n) => belongsToCanvas(n.canvasId, canvasId)).toArray();
  const edges = await db.edges.filter((e) => belongsToCanvas(e.canvasId, canvasId)).toArray();

  if (nodes.length > 0) await db.nodes.bulkDelete(nodes.map((n) => n.id));
  if (edges.length > 0) await db.edges.bulkDelete(edges.map((e) => e.id));

  // 长文的「关联画布」留着会显示成一串裸 id，顺手摘掉
  const linked = await db.articles.filter((a) => (a.linkedCanvasIds ?? []).includes(canvasId)).toArray();
  for (const article of linked) {
    await db.articles.update(article.id, {
      linkedCanvasIds: (article.linkedCanvasIds ?? []).filter((id) => id !== canvasId),
    });
  }

  await db.canvases.delete(canvasId);

  // 画布都没了，它的撤销栈只会指向一堆已经不存在的行——撤回来也没地方显示
  clearCanvasHistory(canvasId);
}
