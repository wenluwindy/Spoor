import { useCallback, useState } from 'react';
import { db } from '../db';
import { fetchWebPageMeta } from '../services/webPage';
import { canvasIdOf, updateNodeRecorded } from '../services/canvasMutations';

/**
 * 网页卡片的抓取动作。
 *
 * 「正在抓」的状态放内存不入库，与生图节点同一套取舍：重启后不该有卡片卡在转圈上。
 * 抓取**结果**当然要落库，而且走 `updateNodeRecorded`——抓回来的内容替换了卡片上原有的
 * 东西，撤销一次应该能退回抓取之前。
 */
export function useWebNodeActions() {
  const [fetchingNodeIds, setFetchingNodeIds] = useState<Set<string>>(new Set());

  const markFetching = useCallback((nodeId: string, active: boolean) => {
    setFetchingNodeIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(nodeId);
      else next.delete(nodeId);
      return next.size === prev.size && active === prev.has(nodeId) ? prev : next;
    });
  }, []);

  const fetchInto = useCallback(
    async (nodeId: string, url: string) => {
      const node = await db.nodes.get(nodeId);
      if (!node) return;
      const canvasId = canvasIdOf(node);

      markFetching(nodeId, true);
      try {
        const meta = await fetchWebPageMeta(url);
        await updateNodeRecorded(canvasId, nodeId, {
          url: meta.url,
          urlTitle: meta.title,
          urlSiteName: meta.siteName,
          urlExcerpt: meta.excerpt,
          urlImage: meta.image,
          urlFetchedAt: Date.now(),
          urlError: '',
        });
      } catch (e) {
        // 地址仍然写进去：卡片上留着它，用户才知道刚才试的是哪个链接、能原地重试
        await updateNodeRecorded(canvasId, nodeId, {
          url,
          urlError: e instanceof Error ? e.message : 'web.fetch_failed',
          urlFetchedAt: Date.now(),
        });
      } finally {
        markFetching(nodeId, false);
      }
    },
    [markFetching],
  );

  return { fetchingNodeIds, fetchInto };
}
