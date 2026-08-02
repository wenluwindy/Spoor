/**
 * 镜像的启动编排（仅桌面端）：读文件 → 对账合并 → 启动调度器 → 补齐缺失镜像。
 *
 * 顺序有讲究：对账必须在调度器**之前**——否则合并写库会触发镜像重写，
 * 拿着还没合并完的库状态把文件里更新的内容盖掉。
 */

import { db, type AgentConfig, type Article, type CanvasTemplate } from '../db';
import {
  GLOBAL_MIRROR_FILES,
  parseCanvasMirrorFile,
  parseGlobalMirrorFile,
} from './canvasMirror';
import {
  planCanvasMerge,
  planGlobalMerge,
  planHasChanges,
  type CanvasMergePlan,
} from './mirrorReconcile';
import { initMirrorScheduler } from './mirrorScheduler';
import { notifyMirrorChange } from './mirrorSignals';
import { buildBackup, serializeBackup } from './backup';
import { logger } from '../utils/logger';

export interface MirrorStartupReport {
  importedCanvases: string[];
  mergedCanvases: { name: string; added: number; updated: number }[];
  foreignFiles: string[];
}

/** 合并前落一份带时间戳的快照：对账写坏了还有路可退。失败不阻断（尽力而为）。 */
async function writePreMergeSnapshot(appVersion: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    await invoke('snapshot_write', {
      name: `pre-merge-${stamp}.json`,
      contents: serializeBackup(await buildBackup(appVersion, Date.now())),
    });
  } catch (e) {
    logger.warn('mirror', '合并前快照失败（继续对账：合并本身是并集，不删数据）', e);
  }
}

async function applyCanvasPlan(plan: CanvasMergePlan): Promise<void> {
  await db.transaction('rw', [db.canvases, db.nodes, db.edges, db.aiTurns, db.mirrorState], async () => {
    if (plan.canvasUpsert) await db.canvases.put(plan.canvasUpsert);
    if (plan.nodeUpserts.length > 0) await db.nodes.bulkPut(plan.nodeUpserts);
    if (plan.edgeUpserts.length > 0) await db.edges.bulkPut(plan.edgeUpserts);
    if (plan.aiTurnUpserts.length > 0) await db.aiTurns.bulkPut(plan.aiTurnUpserts);
    await db.mirrorState.put(plan.nextState);
  });
}

/**
 * 启动入口。调用方（App）只在 Tauri 运行时调它一次。
 * 返回给 UI 的报告：合并了什么、有没有网盘冲突副本要人工处理。
 */
export async function runMirrorStartup(appVersion: string): Promise<MirrorStartupReport> {
  const { invoke } = await import('@tauri-apps/api/core');
  const report: MirrorStartupReport = { importedCanvases: [], mergedCanvases: [], foreignFiles: [] };

  let files: { name: string; content: string }[] = [];
  try {
    files = await invoke<{ name: string; content: string }[]>('notes_read_all');
    report.foreignFiles = await invoke<string[]>('notes_list_foreign');
  } catch (e) {
    // 读不到镜像目录（数据根不可写等）：跳过对账但仍启动调度器——写路径也许能自愈
    logger.error('mirror', '镜像目录读取失败，跳过对账', e);
  }

  // 先算好全部计划，需要合并才落快照（不打扰单机用户的启动路径）
  const canvasPlans: CanvasMergePlan[] = [];
  for (const file of files) {
    if (!file.name.endsWith('.canvas')) continue;
    const parsed = parseCanvasMirrorFile(file.content);
    if (!parsed) {
      logger.warn('mirror', '跳过无法解析的镜像文件', file.name);
      continue;
    }
    const canvasId = parsed.spoorMeta.canvasId;
    const [canvas, nodes, edges, aiTurns, mirrorState] = await Promise.all([
      db.canvases.get(canvasId),
      db.nodes.where('canvasId').equals(canvasId).toArray(),
      db.edges.where('canvasId').equals(canvasId).toArray(),
      db.aiTurns.where('canvasId').equals(canvasId).toArray(),
      db.mirrorState.get(canvasId),
    ]);
    const plan = planCanvasMerge(parsed, { canvas, nodes, edges, aiTurns, mirrorState });
    if (plan.kind === 'in-sync') continue;
    if (!planHasChanges(plan)) {
      // 内容等价但 savedAt 不同（比如重装后首次对账）：只把记账追平
      await db.mirrorState.put(plan.nextState);
      continue;
    }
    canvasPlans.push(plan);
  }

  const needsSnapshot = canvasPlans.some((p) => p.kind === 'merge');
  if (needsSnapshot) await writePreMergeSnapshot(appVersion);

  for (const plan of canvasPlans) {
    await applyCanvasPlan(plan);
    if (plan.kind === 'import-new') {
      report.importedCanvases.push(plan.canvasUpsert?.name ?? plan.canvasId);
    } else {
      report.mergedCanvases.push({
        name: plan.canvasUpsert?.name ?? (await db.canvases.get(plan.canvasId))?.name ?? plan.canvasId,
        ...plan.stats,
      });
    }
  }

  // 全局表：只补文件独有的行（无行级时间戳，本机优先）
  for (const scope of ['articles', 'agents', 'templates'] as const) {
    const file = files.find((f) => f.name === GLOBAL_MIRROR_FILES[scope]);
    if (!file) continue;
    const parsed = parseGlobalMirrorFile(file.content);
    if (!parsed || parsed.scope !== scope) continue;
    const table = scope === 'articles' ? db.articles : scope === 'agents' ? db.agents : db.templates;
    const plan = planGlobalMerge(
      scope,
      parsed.rows as unknown as (Article | AgentConfig | CanvasTemplate)[],
      parsed.savedAt,
      parsed.revision,
      await table.toArray(),
      await db.mirrorState.get(scope),
    );
    if (!plan) continue;
    if (plan.upserts.length > 0) {
      await (table as typeof db.articles).bulkPut(plan.upserts as Article[]);
    }
    await db.mirrorState.put(plan.nextState);
  }

  // 对账完再开写入端
  await initMirrorScheduler();

  // 还没有镜像的画布/全局表补一份初稿（首次启用镜像的存量用户）；
  // 刚合并过的画布也标脏——库里可能有文件缺的本机内容，让文件追上来
  const [allCanvases, states] = await Promise.all([db.canvases.toArray(), db.mirrorState.toArray()]);
  const known = new Set(states.map((s) => s.id));
  for (const canvas of allCanvases) {
    if (!known.has(canvas.id)) notifyMirrorChange(canvas.id);
  }
  for (const scope of ['articles', 'agents', 'templates'] as const) {
    if (!known.has(scope)) notifyMirrorChange(scope);
  }
  for (const plan of canvasPlans) notifyMirrorChange(plan.canvasId);

  return report;
}
