import { FileText, Film, Image as ImageIcon, Plus, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * 画布「新建 / 插入」项的唯一定义源。
 *
 * 工具栏底部 `+` 悬浮菜单与画布右键菜单共用这里的定义，避免同一份菜单在两处各自演化。
 * 组件只负责渲染与绑定处理器，文案与图标一律从这里取。
 */

/** 新建节点项：直接写入一个空白节点。 */
export interface CanvasCreateItemDef {
  id: 'note' | 'theme';
  /**
   * 实际写入数据库的 `CanvasNode.type`。
   *
   * 注意：「便签」历史上用的是 `'text'` 而非 `'note'`——`'note'` 只出现在早期种子数据里，
   * 两者在 `NodeRenderer` / `nodeCapabilities` / 剪贴板逻辑中完全同构。新建一律用 `'text'`。
   */
  nodeType: 'text' | 'theme';
  labelKey: string;
  icon: LucideIcon;
  /** 图标使用强调色 `#C2410C`（而非默认的 `#5a5a54`）。 */
  accent?: boolean;
}

/** 插入文件项：唤起文件选择，落盘后建节点。 */
export interface CanvasInsertItemDef {
  id: 'image' | 'video' | 'document';
  labelKey: string;
  icon: LucideIcon;
  /** `<input type="file">` 的 accept，与 `processFileToNode` 支持的类型保持一致。 */
  accept: string;
}

export const CANVAS_CREATE_ITEMS: readonly CanvasCreateItemDef[] = [
  {
    id: 'note',
    nodeType: 'text',
    labelKey: 'sidebar.new_note',
    icon: Plus,
  },
  {
    id: 'theme',
    nodeType: 'theme',
    labelKey: 'sidebar.new_theme_card',
    icon: Sparkles,
    accent: true,
  },
] as const;

export const CANVAS_INSERT_ITEMS: readonly CanvasInsertItemDef[] = [
  {
    id: 'image',
    labelKey: 'canvas.menu.insert_image',
    icon: ImageIcon,
    accept: 'image/*',
  },
  {
    id: 'video',
    labelKey: 'canvas.menu.insert_video',
    icon: Film,
    accept: 'video/*',
  },
  {
    id: 'document',
    labelKey: 'canvas.menu.insert_document',
    icon: FileText,
    accept: '.docx,.txt,.md',
  },
] as const;

/** 上传按钮/拖放沿用的全类型 accept（与 `CANVAS_INSERT_ITEMS` 的并集一致）。 */
export const CANVAS_ALL_FILE_ACCEPT = 'image/*,video/*,.docx,.txt,.md';
