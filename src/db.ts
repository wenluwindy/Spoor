import Dexie, { type Table } from 'dexie';

export interface CanvasNode {
  id: string;
  canvasId?: string;
  type: string;
  /**
   * 建行/改行时间戳。由 `db.ts` 的 Dexie hook 自动盖章，业务代码不手填——
   * 这也是未来任何形式多设备合并的最低前提（没有时间戳连"最后写入胜出"都做不了）。
   * 旧行由 v5 迁移补齐，故运行时可视为必有；类型上保持可选以兼容导入的外部数据。
   */
  createdAt?: number;
  updatedAt?: number;
  /** 节点标签，用于筛选与搜索（v5 起，multiEntry 索引）。 */
  tags?: string[];
  /**
   * 色板改出的外观（背景/文字/字体/边框色）。只存被改过的键；
   * 空对象等于没改。曾经只存在组件 state 里，刷新即丢——那是 0.3.x 的缺陷。
   */
  styleOverrides?: { bg?: string; text?: string; font?: string; border?: string };
  content?: string;
  description?: string;
  /** Theme card footer label (editable); default differs by layout when unset/empty */
  themeTag?: string;
  agentConfigId?: string;
  fileType?: string;
  /**
   * 媒体/文档在数据根内的**相对**路径（`media/uploaded/2026/07/ab12.png`）。
   * 渲染优先级 `filePath` > `content`（旧的 data URL）。绝不存绝对路径——
   * 安装目录一变，绝对路径全断。
   */
  filePath?: string;
  /** 原始文件名，用于显示与「另存为」。 */
  fileName?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  layout?: number;
  /** 画布 AI 对话卡：本回合用户追问（上半区）；`content` 为 AI 回复（下半区） */
  userTurn?: string;
  /** 已从该卡成功发出过追问并生成下游 AI 卡后隐藏追问输入，保持卡片简洁 */
  followUpSent?: boolean;
  /** Agent 分析链：首张 AI 卡记录源便签 id；追问链上子卡从父卡复制 */
  threadRootContextNodeId?: string;
  /** Agent 分析链：首张 AI 卡记录 `AgentConfig.id`；子卡从父卡复制 */
  threadAgentConfigId?: string;
  /** Agent 分析链：首轮附带的多模态图片节点 id（便签/Agent 邻接 image）；子卡从父卡复制 */
  threadContextImageNodeIds?: string[];

  // ── type === 'canvasLink'（跨画布传送门）──
  /**
   * 指向哪张画布。目标被删掉时这里会指向一个不存在的 id——渲染层据此显示「已删除」，
   * 而不是把卡片一起删掉：留着这张卡至少还看得出"这里原本连去别处"。
   */
  targetCanvasId?: string;

  // ── type === 'web'（网页卡片）──
  url?: string;
  urlTitle?: string;
  urlSiteName?: string;
  /** 正文摘要，同时作为 AI 上下文。 */
  urlExcerpt?: string;
  /** 封面图的**远程**地址（不落盘：一张封面不值得占一份本地存储）。 */
  urlImage?: string;
  urlFetchedAt?: number;
  /** 抓取失败的原因码，重开画布时仍显示错误态。 */
  urlError?: string;

  // ── type === 'document' 且 fileType === 'pdf' ──
  /** 上次读到第几页（1 起）。 */
  pdfPage?: number;
  pdfPageCount?: number;

  // ── type === 'frame'（区域框）──
  /**
   * 框内成员**按几何关系判定**（拖动时取框内的卡片），不存 parentId。
   * 存一份成员表意味着每次移动、删除、撤销都要维护它的一致性，而画布上"在不在框里"
   * 本来就是看出来的——让数据跟着眼睛走，比让眼睛跟着数据走可靠。
   */

  // ── type === 'imagegen' ──
  /** 用哪个服务商/模型生图；为空时用设置里的全局默认。 */
  imageGenProviderId?: string;
  imageGenModelId?: string;
  /** 节点自己的提示词，会拼在上游文本之后。 */
  imageGenPrompt?: string;
  /** 只用节点自己的提示词，忽略连过来的文本节点。 */
  imageGenIgnoreUpstreamText?: boolean;
  imageGenParams?: { size?: string; n?: number };
  /**
   * 结果图相对路径，**最新在前**，不设上限（决策 11：历史永久保留，
   * 由用户在设置 → 存储里自行管理）。
   */
  imageGenResults?: string[];
  imageGenActiveIndex?: number;
  /** 被用户点掉、不参与本次生成的参考图节点 id。 */
  imageGenExcludedRefIds?: string[];
  /** 上次失败的错误码，用于重新打开画布时仍显示错误态。 */
  imageGenErrorCode?: string;
  imageGenErrorDetail?: string;

  // ── type === 'image' 且由生图产出（结果卡片）──
  /**
   * 这张图是怎么生成的。只有生图产出的结果卡片带它，手动导入的图片节点没有。
   * 存快照而非引用生图节点：生图节点被删或参数被改后，结果卡上的记录仍应如实反映
   * 当时那一次生成。
   */
  imageGenMeta?: {
    prompt: string;
    providerName: string;
    modelName: string;
    size?: string;
    /** 本次用到的参考图相对路径（无参考图时为空数组）。 */
    refPaths: string[];
    createdAt: number;
  };
}

export interface Canvas {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  date: string;
  type: string;
  author?: string;
  tags?: string[];
  privateNotes?: string;
  linkedCanvasIds?: string[];
}

/** Markdown 知识：文件内容持久化在 IndexedDB，调用模型时整段注入 system（非 RAG）。 */
export interface AgentMarkdownKnowledgeFile {
  name: string;
  content: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  prompt: string;
  temperature?: number;
  creativity?: number;
  color?: string;
  knowledgeMarkdownFiles?: AgentMarkdownKnowledgeFile[];
}

export interface Edge {
  id: string;
  canvasId?: string;
  from: string;
  to: string;
  /** 见 `CanvasNode.createdAt` 的说明；边没有可编辑内容，不设 updatedAt。 */
  createdAt?: number;
}

/**
 * AI 文本卡的一次生成结果（v5 起）。
 *
 * 与生图节点的 `imageGenResults` 对齐心智：重新生成/沿边重算**不再覆盖旧回答**，
 * 而是每次生成落一条 turn，卡片当前显示哪条由 `CanvasNode.content` 决定
 * （content 始终等于「被固定的那条」的全文，这样旧版本导出/搜索/AI 上下文全部无感）。
 */
export interface AiTurn {
  id: string;
  /** 所属 AI 卡节点 id。节点被删时由删除方顺手清掉本表对应行。 */
  nodeId: string;
  canvasId: string;
  /** 该版回答全文。 */
  content: string;
  /** 触发该版生成的追问文本（没有追问的首轮生成为空）。 */
  userTurn?: string;
  agentConfigId?: string;
  createdAt: number;
}

/** 画布模板（v5 起）：一组节点 + 连线的可复用快照，坐标已归一化到左上角原点。 */
export interface CanvasTemplate {
  id: string;
  name: string;
  createdAt: number;
  nodes: CanvasNode[];
  edges: Edge[];
}

/** 深度研究实验室：一次已完成研究的本地快照（独立于 articles）。 */
export interface ResearchPlanStepRecord {
  title: string;
  desc: string;
}

export interface ResearchReportRecord {
  intro: string;
  points: { title: string; text: string }[];
  conclusion: string;
}

export type ResearchSessionSearchStatus = 'idle' | 'searching' | 'found' | 'fallback';

/** Minimal webpage snapshot stored with a research session (sidebar sources). */
export interface ResearchSessionWebpageSnapshot {
  title: string;
  link: string;
  snippet: string;
}

/** AI 助手「测试沙盒」：按人设 id 持久化多轮对话（仅本地 IndexedDB）。 */
export interface AgentSandboxThread {
  agentId: string;
  messages: { role: 'user' | 'model'; text: string }[];
  updatedAt: number;
}

export interface ResearchSession {
  id: string;
  query: string;
  createdAt: number;
  updatedAt: number;
  researchPlan: ResearchPlanStepRecord[];
  researchReport: ResearchReportRecord;
  sourceCount: number;
  searchStatus: ResearchSessionSearchStatus;
  /** URLs/snippets from the last Metaso search used for this run (optional on legacy rows). */
  searchWebpages?: ResearchSessionWebpageSnapshot[];
}

export class MyDatabase extends Dexie {
  nodes!: Table<CanvasNode>;
  articles!: Table<Article>;
  agents!: Table<AgentConfig>;
  edges!: Table<Edge>;
  canvases!: Table<Canvas>;
  researchSessions!: Table<ResearchSession>;
  agentSandboxThreads!: Table<AgentSandboxThread>;
  aiTurns!: Table<AiTurn>;
  templates!: Table<CanvasTemplate>;

  /** name 参数仅供迁移测试用另一个库名走一遍完整升级链，产品代码不传。 */
  constructor(name = 'CortexLocalDB') {
    super(name);
    this.version(1).stores({
      nodes: '++id, type, agentConfigId',
      articles: '++id, type, date',
      agents: '++id, role',
      edges: '++id, from, to'
    });

    this.version(2).stores({
      nodes: '++id, type, agentConfigId, canvasId',
      edges: '++id, from, to, canvasId',
      canvases: '++id, name, createdAt'
    });

    this.version(3).stores({
      researchSessions: 'id, createdAt',
    });

    this.version(4).stores({
      agentSandboxThreads: 'agentId',
    });

    /**
     * v5：0.4.0 需要的 schema 一次到位（索引变更才需要迁移，能合的都合在这一版）。
     * - nodes/articles 加 `*tags` multiEntry 索引（标签筛选），nodes 加 `updatedAt`（最近编辑）；
     * - 新表 aiTurns（AI 卡生成历史）与 templates（画布模板）；
     * - upgrade 把历史行的 `canvasId` 一次性补成 'default'、盖上时间戳——
     *   此后查询可以放心走 `where('canvasId')` 索引，不必在每个热路径上兜底。
     */
    this.version(5)
      .stores({
        nodes: '++id, type, agentConfigId, canvasId, updatedAt, *tags',
        articles: '++id, type, date, *tags',
        aiTurns: 'id, nodeId, canvasId, createdAt',
        templates: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        await tx.table('nodes').toCollection().modify((n: CanvasNode) => {
          if (!n.canvasId) n.canvasId = 'default';
          if (!n.createdAt) n.createdAt = now;
          if (!n.updatedAt) n.updatedAt = n.createdAt;
        });
        await tx.table('edges').toCollection().modify((e: Edge) => {
          if (!e.canvasId) e.canvasId = 'default';
          if (!e.createdAt) e.createdAt = now;
        });
      });

    /**
     * 时间戳与 canvasId 由 hook 统一盖章，而不是散在每个调用点：
     * 漏一个调用点就会出现 `where('canvasId')` 查不到的"幽灵行"，hook 让这类 bug 不可能发生。
     * 导入/撤销还原自带时间戳的行时保留原值（`??=`）。
     */
    this.nodes.hook('creating', (_pk, obj: CanvasNode) => {
      const now = Date.now();
      if (!obj.canvasId) obj.canvasId = 'default';
      obj.createdAt ??= now;
      obj.updatedAt ??= now;
    });
    this.nodes.hook('updating', (mods: Partial<CanvasNode>) => {
      // 空修改（比如迁移 modify 扫过但没改的行）不算一次编辑，不盖章。
      if (Object.keys(mods).length === 0) return undefined;
      if ('updatedAt' in mods) return undefined;
      return { updatedAt: Date.now() };
    });
    this.edges.hook('creating', (_pk, obj: Edge) => {
      if (!obj.canvasId) obj.canvasId = 'default';
      obj.createdAt ??= Date.now();
    });
  }
}

export const db = new MyDatabase();
