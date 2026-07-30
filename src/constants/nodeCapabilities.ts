/**
 * Canvas 节点按职责划分（对应 `NodeRenderer` 的分支）：
 *
 * - **语义与版式可调**：`theme`、`note`、`text` — UI 读取 `layout` 切换多套样式（便签/文本为 0–4，主题为 0–3）。
 * - **AI 链路**：`ai`（生成/追问卡片）、`agent`（实体 Agent 卡片）— 不参与版式轮换。
 * - **介质**：`image`、`video`、`document` — 固定外壳，不参加版式轮换。
 */

export const NODE_TYPES_WITH_LAYOUT_CYCLE = ['theme', 'note', 'text'] as const;

export type NodeTypeWithLayoutCycle = (typeof NODE_TYPES_WITH_LAYOUT_CYCLE)[number];

const LAYOUT_CYCLE_SET = new Set<string>(NODE_TYPES_WITH_LAYOUT_CYCLE);

export function nodeSupportsCycleLayout(nodeType: string): nodeType is NodeTypeWithLayoutCycle {
  return LAYOUT_CYCLE_SET.has(nodeType);
}

/**
 * 正文可就地编辑的类型（`NodeRenderer` 里会读 `editingNodeId` 切换到 contentEditable）。
 *
 * `document` 用 `dangerouslySetInnerHTML` 渲染、`image` / `video` 是介质外壳、
 * `agent` 是实体卡片——都没有可编辑正文，右键菜单不应给出「编辑内容」。
 */
export const NODE_TYPES_WITH_INLINE_EDIT = ['theme', 'note', 'text', 'ai'] as const;

export type NodeTypeWithInlineEdit = (typeof NODE_TYPES_WITH_INLINE_EDIT)[number];

const INLINE_EDIT_SET = new Set<string>(NODE_TYPES_WITH_INLINE_EDIT);

export function nodeSupportsInlineEdit(nodeType: string): nodeType is NodeTypeWithInlineEdit {
  return INLINE_EDIT_SET.has(nodeType);
}
