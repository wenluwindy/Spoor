import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Copy, Link2, Pencil, RotateCcw, SlidersHorizontal, Square, SquareCheckBig, Trash2 } from 'lucide-react';
import type { AgentConfig, CanvasNode } from '../../db';
import { CANVAS_CREATE_ITEMS, CANVAS_INSERT_ITEMS } from '../../constants/canvasMenuItems';
import { nodeSupportsCycleLayout, nodeSupportsInlineEdit } from '../../constants/nodeCapabilities';
import { resolveAgentLocalizedName } from '../../utils/aiI18n';
import {
  parseStickyClipboardPayload,
  type StickyClipboardPayloadV1,
} from '../../utils/noteClipboard';
import type { CanvasContextMenuState } from '../../hooks/useCanvasContextMenu';
import { ContextMenuSurface, type ContextMenuSection } from './ContextMenuSurface';

export interface CanvasPoint {
  x: number;
  y: number;
}

/** 菜单只发意图，具体落库由 `useNodeActions` / App 负责。 */
export interface CanvasContextMenuActions {
  createNode: (nodeType: 'text' | 'theme', at: CanvasPoint) => void;
  insertFile: (accept: string, at: CanvasPoint) => void;
  addAgentNode: (agentConfigId: string, at: CanvasPoint) => void;
  pasteSticky: (payload: StickyClipboardPayloadV1, at: CanvasPoint) => void;
  resetView: () => void;
  editNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  startLink: (nodeId: string) => void;
  cycleLayout: (nodeId: string) => void;
  toggleSelect: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
}

export interface CanvasContextMenuProps {
  menu: CanvasContextMenuState;
  onClose: () => void;
  agentConfigs: AgentConfig[];
  nodesById: Map<string, CanvasNode>;
  selectedNodes: Set<string>;
  actions: CanvasContextMenuActions;
}

export function CanvasContextMenu({
  menu,
  onClose,
  agentConfigs,
  nodesById,
  selectedNodes,
  actions,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();
  const isCanvasTarget = menu.target.kind === 'canvas';

  /**
   * 剪贴板只能异步读，所以「粘贴便签」先禁用、探测到可用负载后再点亮。
   * 读取被拒绝时保持禁用——这比给一个点了没反应的菜单项更诚实。
   */
  const [pasteable, setPasteable] = useState<StickyClipboardPayloadV1 | null>(null);
  useEffect(() => {
    if (!isCanvasTarget) return;
    let cancelled = false;
    const read = navigator.clipboard?.readText?.();
    if (!read) return;
    void read
      .then((text) => {
        if (!cancelled) setPasteable(parseStickyClipboardPayload(text));
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
      if (nodeSupportsCycleLayout(nodeType)) {
        primary.push({
          id: 'cycle-layout',
          label: t('canvas.cycle_layout'),
          icon: SlidersHorizontal,
          onSelect: () => actions.cycleLayout(nodeId),
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
          id: 'paste-sticky',
          label: t('canvas.menu.paste_sticky'),
          icon: Copy,
          disabled: pasteable === null,
          onSelect: () => {
            if (pasteable) actions.pasteSticky(pasteable, at);
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
  }, [menu, t, actions, agentConfigs, nodesById, selectedNodes, pasteable]);

  return (
    <ContextMenuSurface
      x={menu.screenX}
      y={menu.screenY}
      sections={sections}
      onClose={onClose}
    />
  );
}
