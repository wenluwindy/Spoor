import { db } from '../db';
import { clearCanvasHistory } from './canvasHistory';

/**
 * 画布本身的增删。节点/连线的增删见 `hooks/useNodeActions`。
 */

/**
 * 删除画布，连同它的节点、连线，以及长文里指向它的引用。
 *
 * 不做「最后一张画布」的判断——那是 UI 的事（`CanvasHistoryPopover` 会禁用按钮），
 * 这里只负责把该画布的痕迹清干净。
 */
export async function deleteCanvasWithContents(canvasId: string): Promise<void> {
  // canvasId 由 v5 迁移与 db hook 保证必有，直接走索引删
  await db.nodes.where('canvasId').equals(canvasId).delete();
  await db.edges.where('canvasId').equals(canvasId).delete();
  // AI 卡的生成历史跟画布走。单删节点时刻意不清（撤销恢复卡片后历史还在），
  // 删整张画布是唯一确定"再也回不来"的时刻。
  await db.aiTurns.where('canvasId').equals(canvasId).delete();

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
