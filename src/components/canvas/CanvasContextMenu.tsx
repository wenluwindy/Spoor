import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Copy, Download, ImageDown, Link2, Pencil, PenLine, RotateCcw, Square, SquareCheckBig, Trash2 } from 'lucide-react';
import type { AgentConfig, CanvasNode } from '../../db';
import { isTauriRuntime } from '../../utils/isTauriRuntime';
import { CANVAS_CREATE_ITEMS, CANVAS_INSERT_ITEMS } from '../../constants/canvasMenuItems';
import { nodeSupportsInlineEdit } from '../../constants/nodeCapabilities';
import { resolveAgentLocalizedName } from '../../utils/aiI18n';
import {
  parseCanvasClipboardPayload,
  type CanvasClipboardPayloadV2,
} from '../../utils/canvasClipboard';
import type { CanvasContextMenuState } from '../../hooks/useCanvasContextMenu';
import { ContextMenuSurface, type ContextMenuSection } from './ContextMenuSurface';

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * 这个节点有没有可另存的原件。
 *
 * 图片/视频看 `filePath`（`content` 里的旧 data URL 不在文件存储里，导不出去）；
 * 生图节点看当前是否已有结果。浏览器下没有文件存储，一律不给入口。
 */
export function canSaveNodeMedia(node: CanvasNode | undefined): boolean {
  if (!node || !isTauriRuntime()) return false;
  if (node.type === 'image' || node.type === 'video') return Boolean(node.filePath);
  if (node.type === 'imagegen') return (node.imageGenResults?.length ?? 0) > 0;
  return false;
}

/** 菜单只发意图，具体落库由 `useNodeActions` / App 负责。 */
export interface CanvasContextMenuActions {
  createNode: (nodeType: 'text' | 'theme' | 'imagegen', at: CanvasPoint) => void;
  insertFile: (accept: string, at: CanvasPoint) => void;
  addAgentNode: (agentConfigId: string, at: CanvasPoint) => void;
  pasteNodes: (payload: CanvasClipboardPayloadV2, at: CanvasPoint) => void;
  resetView: () => void;
  editNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  startLink: (nodeId: string) => void;
  toggleSelect: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  /** 星型连线：除 `hubId` 外的选中节点全部连向它。 */
  linkNodesToHub: (nodeIds: string[], hubId: string) => void;
  /** 生图节点：把当前结果输出成独立的 image 节点并连线。 */
  outputAsImageNode: (nodeId: string) => void;
  /** 图片/视频/生图结果：另存到用户选定的位置。 */
  saveNodeMediaAs: (nodeId: string) => void;
  /** 连线拖到空白处：建一张卡并从 `fromId` 连过去。 */
  createNodeLinkedFrom: (
    nodeType: 'text' | 'theme' | 'imagegen',
    at: CanvasPoint,
    fromId: string,
  ) => void;
  /** 连线拖到空白处：插入文件建卡并从 `fromId` 连过去。 */
  insertFileLinkedFrom: (accept: string, at: CanvasPoint, fromId: string) => void;
  synthesizeSelected: () => void;
  clearSelection: () => void;
  deleteNodes: (nodeIds: string[]) => void;
}

export interface CanvasContextMenuProps {
  menu: CanvasContextMenuState;
  onClose: () => void;
  agentConfigs: AgentConfig[];
  nodesById: Map<string, CanvasNode>;
  selectedNodes: Set<string>;
  actions: CanvasContextMenuActions;
  /** AI 正忙时禁用「合成长文」，与右上角合成按钮保持一致。 */
  isSynthesizeDisabled?: boolean;
}

export function CanvasContextMenu({
  menu,
  onClose,
  agentConfigs,
  nodesById,
  selectedNodes,
  actions,
  isSynthesizeDisabled,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();
  const isCanvasTarget = menu.target.kind === 'canvas';

  /**
   * 剪贴板只能异步读，所以「粘贴」先禁用、探测到可用负载后再点亮。
   * 读取被拒绝时保持禁用——这比给一个点了没反应的菜单项更诚实。
   */
  const [pasteable, setPasteable] = useState<CanvasClipboardPayloadV2 | null>(null);
  useEffect(() => {
    if (!isCanvasTarget) return;
    let cancelled = false;
    const read = navigator.clipboard?.readText?.();
    if (!read) return;
    void read
      .then((text) => {
        if (!cancelled) setPasteable(parseCanvasClipboardPayload(text));
      })
      .catch(() => {
        /* 剪贴板不可读：保持禁用 */
      });
    return () => {
      cancelled = true;
    };
  }, [isCanvasTarget, menu.screenX, menu.screenY]);

  const sections = useMemo<ContextMenuSection[]>(() => {
    const at: CanvasPoint = { x: menu.canvasX, y: menu.canvasY };

    if (menu.target.kind === 'edge') {
      const edgeId = menu.target.edgeId;
      return [
        {
          id: 'edge',
          entries: [
            {
              id: 'delete-edge',
              label: t('canvas.menu.delete_edge'),
              icon: Trash2,
              danger: true,
              onSelect: () => actions.deleteEdge(edgeId),
            },
          ],
        },
      ];
    }

    if (menu.target.kind === 'nodes') {
      const { nodeIds, anchorId } = menu.target;
      return [
        {
          id: 'multi',
          entries: [
            {
              id: 'link-all',
              label: t('canvas.menu.link_all_to_this', { count: nodeIds.length - 1 }),
              icon: Link2,
              disabled: nodeIds.length < 2,
              onSelect: () => actions.linkNodesToHub(nodeIds, anchorId),
            },
            {
              id: 'synthesize',
              label: t('canvas.menu.synthesize_selected', { count: nodeIds.length }),
              icon: PenLine,
              accent: true,
              disabled: isSynthesizeDisabled,
              onSelect: () => actions.synthesizeSelected(),
            },
            {
              id: 'clear-selection',
              label: t('canvas.menu.clear_selection'),
              icon: Square,
              onSelect: () => actions.clearSelection(),
            },
          ],
        },
        {
          id: 'multi-danger',
          entries: [
            {
              id: 'delete-selected',
              label: t('canvas.menu.delete_selected', { count: nodeIds.length }),
              icon: Trash2,
              danger: true,
              onSelect: () => actions.deleteNodes(nodeIds),
            },
          ],
        },
      ];
    }

    if (menu.target.kind === 'node') {
      const nodeId = menu.target.nodeId;
      const node = nodesById.get(nodeId);
      const nodeType = node?.type ?? '';
      const isSelected = selectedNodes.has(nodeId);

      const primary: ContextMenuSection['entries'] = [];
      if (nodeSupportsInlineEdit(nodeType)) {
        primary.push({
          id: 'edit',
          label: t('canvas.menu.edit_content'),
          icon: Pencil,
          onSelect: () => actions.editNode(nodeId),
        });
      }
      primary.push(
        {
          id: 'duplicate',
          label: t('canvas.menu.duplicate'),
          icon: Copy,
          onSelect: () => actions.duplicateNode(nodeId),
        },
        {
          id: 'link',
          label: t('canvas.menu.start_link'),
          icon: Link2,
          onSelect: () => actions.startLink(nodeId),
        },
      );
      // 生图节点：把当前结果固化成一个普通图片节点，方便当作下游参考图或导出
      if (nodeType === 'imagegen' && (node?.imageGenResults?.length ?? 0) > 0) {
        primary.push({
          id: 'output-as-image',
          label: t('imagegen.output_as_image'),
          icon: ImageDown,
          onSelect: () => actions.outputAsImageNode(nodeId),
        });
      }
      // 图片/视频有原件、生图节点有结果时给「另存为」；浏览器下没有文件存储，不出现
      if (canSaveNodeMedia(node)) {
        primary.push({
          id: 'save-as',
          label: t('canvas.menu.save_as'),
          icon: Download,
          onSelect: () => actions.saveNodeMediaAs(nodeId),
        });
      }
      primary.push({
        id: 'toggle-select',
        label: isSelected ? t('canvas.menu.unselect') : t('canvas.menu.select'),
        icon: isSelected ? Square : SquareCheckBig,
        onSelect: () => actions.toggleSelect(nodeId),
      });

      return [
        { id: 'node', entries: primary },
        {
          id: 'node-danger',
          entries: [
            {
              id: 'delete-node',
              label: t('canvas.menu.delete_node'),
              icon: Trash2,
              danger: true,
              onSelect: () => actions.deleteNode(nodeId),
            },
          ],
        },
      ];
    }

    if (menu.target.kind === 'link-drop') {
      const fromId = menu.target.fromId;
      return [
        {
          id: 'link-create',
          entries: CANVAS_CREATE_ITEMS.map((item) => ({
            id: `link-create-${item.id}`,
            label: t(item.labelKey),
            icon: item.icon,
            accent: item.accent,
            onSelect: () => actions.createNodeLinkedFrom(item.nodeType, at, fromId),
          })),
        },
        {
          id: 'link-insert',
          entries: CANVAS_INSERT_ITEMS.map((item) => ({
            id: `link-insert-${item.id}`,
            label: t(item.labelKey),
            icon: item.icon,
            onSelect: () => actions.insertFileLinkedFrom(item.accept, at, fromId),
          })),
        },
      ];
    }

    const result: ContextMenuSection[] = [
      {
        id: 'create',
        entries: CANVAS_CREATE_ITEMS.map((item) => ({
          id: `create-${item.id}`,
          label: t(item.labelKey),
          icon: item.icon,
          accent: item.accent,
          onSelect: () => actions.createNode(item.nodeType, at),
        })),
      },
      {
        id: 'insert',
        entries: CANVAS_INSERT_ITEMS.map((item) => ({
          id: `insert-${item.id}`,
          label: t(item.labelKey),
          icon: item.icon,
          onSelect: () => actions.insertFile(item.accept, at),
        })),
      },
    ];

    if (agentConfigs.length > 0) {
      result.push({
        id: 'agents',
        entries: [
          {
            id: 'add-agent',
            label: t('canvas.menu.add_agent'),
            icon: Bot,
            submenu: agentConfigs.map((agent) => ({
              id: `agent-${agent.id}`,
              label: resolveAgentLocalizedName(agent),
              onSelect: () => actions.addAgentNode(agent.id, at),
            })),
          },
        ],
      });
    }

    result.push({
      id: 'misc',
      entries: [
        {
          id: 'paste-nodes',
          label: t('canvas.menu.paste'),
          icon: Copy,
          disabled: pasteable === null,
          onSelect: () => {
            if (pasteable) actions.pasteNodes(pasteable, at);
          },
        },
        {
          id: 'reset-view',
          label: t('canvas.menu.reset_view'),
          icon: RotateCcw,
          onSelect: () => actions.resetView(),
        },
      ],
    });

    return result;
  }, [menu, t, actions, agentConfigs, nodesById, selectedNodes, pasteable, isSynthesizeDisabled]);

  return (
    <ContextMenuSurface
      x={menu.screenX}
      y={menu.screenY}
      sections={sections}
      onClose={onClose}
    />
  );
}
