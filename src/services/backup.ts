/**
 * 全量备份与恢复。
 *
 * 备份的是**数据库里的全部内容 + 无关密钥的偏好设置**，序列化成一个 JSON 文件。
 *
 * 三条刻意的边界：
 *
 * 1. **不含任何 API Key**。`ai_config` 与各家搜索密钥留在原机器上。备份文件常常会被
 *    丢进网盘或聊天窗口，把密钥打包进去是在替用户泄露它们。代价是换机还原后要重填
 *    一次服务配置——这个代价值得付。
 * 2. **不含媒体原件**。图片、视频、文档的字节躺在 `SpoorData/` 里，动辄上 GB，塞进
 *    JSON 既撑爆内存又毫无必要——那个目录本来就可以整个复制走。备份里只留一份
 *    **被引用的相对路径清单**，还原时据此告诉用户还差哪些文件。
 * 3. **还原是整体替换，不是合并**。合并会留下一堆来自两个时空的孤儿行（被删掉的卡片
 *    复活、连线指向不存在的节点）。替换是破坏性的，所以调用方必须先弹危险确认。
 */

import { db } from '../db';
import type {
  AgentConfig,
  AgentSandboxThread,
  Article,
  Canvas,
  CanvasNode,
  Edge,
  ResearchSession,
} from '../db';
import { APP_THEME_STORAGE_KEY } from './appTheme';
import { CANVAS_GRID_STORAGE_KEY } from './canvasGrid';

export const BACKUP_FORMAT = 'spoor-backup' as const;
export const BACKUP_FORMAT_VERSION = 1;

/** 会被备份的偏好键。**新增键要显式加进来**，并先确认它不含密钥。 */
export const BACKED_UP_SETTING_KEYS = [
  APP_THEME_STORAGE_KEY,
  CANVAS_GRID_STORAGE_KEY,
  'app_language',
  'user_name',
  'user_role',
  'user_avatar',
  'active_canvas_id',
] as const;

export interface BackupTables {
  canvases: Canvas[];
  nodes: CanvasNode[];
  edges: Edge[];
  articles: Article[];
  agents: AgentConfig[];
  researchSessions: ResearchSession[];
  agentSandboxThreads: AgentSandboxThread[];
}

export interface SpoorBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  tables: BackupTables;
  /** 偏好设置，绝不含密钥（见 `BACKED_UP_SETTING_KEYS`）。 */
  settings: Record<string, string>;
  /** 被引用到的媒体相对路径，还原时用来核对 `SpoorData/` 里缺了什么。 */
  media: string[];
}

/** 画布上所有指向文件存储的相对路径（去重）。 */
export function collectReferencedMedia(nodes: CanvasNode[]): string[] {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.filePath) paths.add(node.filePath);
    for (const rel of node.imageGenResults ?? []) paths.add(rel);
    for (const rel of node.imageGenMeta?.refPaths ?? []) paths.add(rel);
  }
  return [...paths].sort();
}

function readSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BACKED_UP_SETTING_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

export async function buildBackup(appVersion: string, now: number): Promise<SpoorBackup> {
  const [canvases, nodes, edges, articles, agents, researchSessions, agentSandboxThreads] =
    await Promise.all([
      db.canvases.toArray(),
      db.nodes.toArray(),
      db.edges.toArray(),
      db.articles.toArray(),
      db.agents.toArray(),
      db.researchSessions.toArray(),
      db.agentSandboxThreads.toArray(),
    ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt: now,
    appVersion,
    tables: { canvases, nodes, edges, articles, agents, researchSessions, agentSandboxThreads },
    settings: readSettings(),
    media: collectReferencedMedia(nodes),
  };
}

export function serializeBackup(backup: SpoorBackup): string {
  return `${JSON.stringify(backup)}\n`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 解析备份文件。
 *
 * 版本号比当前**新**的一律拒绝：老版本不认识新字段，硬还原只会写进一堆残缺的行。
 * 宁可让用户去装新版本，也不要留下一个看起来还原成功、实际缺胳膊少腿的库。
 */
export function parseBackup(raw: string): SpoorBackup | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.format !== BACKUP_FORMAT) return null;
  const version = Number(rec.version);
  if (!Number.isFinite(version) || version > BACKUP_FORMAT_VERSION) return null;

  const tables = (rec.tables ?? {}) as Record<string, unknown>;
  return {
    format: BACKUP_FORMAT,
    version,
    createdAt: Number(rec.createdAt) || 0,
    appVersion: typeof rec.appVersion === 'string' ? rec.appVersion : '',
    tables: {
      canvases: asArray<Canvas>(tables.canvases),
      nodes: asArray<CanvasNode>(tables.nodes),
      edges: asArray<Edge>(tables.edges),
      articles: asArray<Article>(tables.articles),
      agents: asArray<AgentConfig>(tables.agents),
      researchSessions: asArray<ResearchSession>(tables.researchSessions),
      agentSandboxThreads: asArray<AgentSandboxThread>(tables.agentSandboxThreads),
    },
    settings:
      rec.settings && typeof rec.settings === 'object'
        ? (rec.settings as Record<string, string>)
        : {},
    media: asArray<string>(rec.media),
  };
}

export interface RestoreSummary {
  canvases: number;
  nodes: number;
  edges: number;
  articles: number;
  agents: number;
}

/**
 * 整体替换本机数据。**破坏性操作**，调用前必须先让用户确认。
 *
 * 只写备份里出现过的偏好键，其余（含密钥）原样不动——还原一份别人的画布
 * 不该把你自己的模型配置一起冲掉。
 */
export async function restoreBackup(backup: SpoorBackup): Promise<RestoreSummary> {
  const { tables } = backup;

  await db.transaction(
    'rw',
    [db.canvases, db.nodes, db.edges, db.articles, db.agents, db.researchSessions, db.agentSandboxThreads],
    async () => {
      await Promise.all([
        db.canvases.clear(),
        db.nodes.clear(),
        db.edges.clear(),
        db.articles.clear(),
        db.agents.clear(),
        db.researchSessions.clear(),
        db.agentSandboxThreads.clear(),
      ]);

      await Promise.all([
        db.canvases.bulkAdd(tables.canvases),
        db.nodes.bulkAdd(tables.nodes),
        db.edges.bulkAdd(tables.edges),
        db.articles.bulkAdd(tables.articles),
        db.agents.bulkAdd(tables.agents),
        db.researchSessions.bulkAdd(tables.researchSessions),
        db.agentSandboxThreads.bulkAdd(tables.agentSandboxThreads),
      ]);
    },
  );

  for (const key of BACKED_UP_SETTING_KEYS) {
    const value = backup.settings[key];
    if (typeof value === 'string') localStorage.setItem(key, value);
  }

  return {
    canvases: tables.canvases.length,
    nodes: tables.nodes.length,
    edges: tables.edges.length,
    articles: tables.articles.length,
    agents: tables.agents.length,
  };
}

/** 备份文件的默认名：`spoor-backup-2026-08-01.json`。 */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `spoor-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
