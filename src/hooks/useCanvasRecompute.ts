import { useCallback, useState } from 'react';
import type { CanvasNode, Edge } from '../db';
import { planRecompute } from '../services/canvasRecompute';

export interface RecomputeSummary {
  /** 真的重跑了几个。 */
  ran: number;
  /** 跳过了几个（没有来历的 AI 卡、缺模型的生图节点…）。 */
  skipped: number;
  failed: number;
}

export interface UseCanvasRecomputeParams {
  nodes: CanvasNode[];
  edges: Edge[];
  regenerateAiNode: (nodeId: string) => Promise<'ok' | 'skipped' | 'failed'>;
  regenerateImageNode: (nodeId: string) => Promise<void>;
}

/**
 * 沿边重算的执行器。
 *
 * 顺序由 `services/canvasRecompute` 算出（纯函数），这里只负责**一个一个地跑**。
 * 刻意不并发：下游节点常常要读上游刚生成的结果，并发会让它们读到旧值；
 * 何况一口气对模型服务发五个请求也容易撞限流。
 *
 * 正在重算的节点集合放内存不入库——和生图、网页抓取同一套取舍，重启后不该有卡片
 * 卡在"正在重算"上。
 */
export function useCanvasRecompute({
  nodes,
  edges,
  regenerateAiNode,
  regenerateImageNode,
}: UseCanvasRecomputeParams) {
  const [recomputingNodeIds, setRecomputingNodeIds] = useState<Set<string>>(new Set());
  const [isRecomputing, setIsRecomputing] = useState(false);

  const recompute = useCallback(
    async (startId: string, includeStart = false): Promise<RecomputeSummary> => {
      const plan = planRecompute(startId, nodes, edges, includeStart);
      const summary: RecomputeSummary = { ran: 0, skipped: 0, failed: 0 };
      if (plan.length === 0) return summary;

      const byId = new Map(nodes.map((n) => [n.id, n]));
      setIsRecomputing(true);
      setRecomputingNodeIds(new Set(plan));

      try {
        for (const id of plan) {
          const node = byId.get(id);
          if (!node) {
            summary.skipped += 1;
            continue;
          }
          try {
            if (node.type === 'imagegen') {
              await regenerateImageNode(id);
              summary.ran += 1;
            } else {
              const outcome = await regenerateAiNode(id);
              if (outcome === 'ok') summary.ran += 1;
              else if (outcome === 'skipped') summary.skipped += 1;
              else summary.failed += 1;
            }
          } catch {
            summary.failed += 1;
          } finally {
            // 跑完一个就从集合里摘掉，界面上能看出进度走到哪
            setRecomputingNodeIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        }
      } finally {
        setIsRecomputing(false);
        setRecomputingNodeIds(new Set());
      }

      return summary;
    },
    [nodes, edges, regenerateAiNode, regenerateImageNode],
  );

  return { recompute, recomputingNodeIds, isRecomputing };
}
