import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlignHorizontalJustifyStart, AlignVerticalJustifyStart, Bot, Copy, Download, ImageDown, Layers, LayoutTemplate, Link2, Pencil, PenLine, Play, RefreshCw, RotateCcw, Sparkles, Square, SquareCheckBig, Tag, Trash2 } from 'lucide-react';
import type { AgentConfig, Canvas, CanvasNode, CanvasTemplate } from '../../db';
import { isTauriRuntime } from '../../utils/isTauriRuntime';
import { CANVAS_CREATE_ITEMS, CANVAS_INSERT_ITEMS } from '../../constants/canvasMenuItems';
import { nodeSupportsInlineEdit } from '../../constants/nodeCapabilities';
import { planRecompute } from '../../services/canvasRecompute';
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
  createNode: (nodeType: 'text' | 'theme' | 'imagegen' | 'web' | 'frame', at: CanvasPoint) => void;
  insertFile: (accept: string, at: CanvasPoint) => void;
  addAgentNode: (agentConfigId: string, at: CanvasPoint) => void;
  addCanvasLink: (targetCanvasId: string, at: CanvasPoint) => void;
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
  recomputeFrom: (nodeId: string, includeStart: boolean) => void;
  /** 图片/视频/生图结果：另存到用户选定的位置。 */
  saveNodeMediaAs: (nodeId: string) => void;
  /** 连线拖到空白处：建一张卡并从 `fromId` 连过去。 */
  createNodeLinkedFrom: (
    nodeType: 'text' | 'theme' | 'imagegen' | 'web' | 'frame',
    at: CanvasPoint,
    fromId: string,
  ) => void;
  /** 连线拖到空白处：插入文件建卡并从 `fromId` 连过去。 */
  insertFileLinkedFrom: (accept: string, at: CanvasPoint, fromId: string) => void;
  synthesizeSelected: () => void;
  clearSelection: () => void;
  deleteNodes: (nodeIds: string[]) => void;
  /** 打标签：单节点与多选共用，弹输入框改这些节点的 tags。 */
  setNodeTags: (nodeIds: string[]) => void;
  /** 对齐选中的卡片（≥2 张）。 */
  alignNodes: (nodeIds: string[], mode: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;
  /** 等间距分布（≥3 张）。 */
  distributeNodes: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  /** 把选中的卡片（连同内部连线）存成模板。 */
  saveAsTemplate: (nodeIds: string[]) => void;
  /** AI 整理：让模型把选中的卡聚类成区域框（先预览后应用）。 */
  organizeNodes: (nodeIds: string[]) => void;
  /** 演示：从这里开始讲；nodeIds 给了则只讲该子集。 */
  startPresentation: (startId?: string, nodeIds?: string[]) => void;
  /** 人格接力：以这张卡为上下文让选定人格出一张新卡。 */
  relayToAgent: (nodeId: string, agentConfigId: string) => void;
  /** 在点击位置插入模板。 */
  insertTemplate: (templateId: string, at: CanvasPoint) => void;
  /** 重命名模板：弹输入框改名后落库。 */
  renameTemplate: (templateId: string) => void;
  deleteTemplate: (templateId: string) => void;
}

export interface CanvasContextMenuProps {
  menu: CanvasContextMenuState;
  onClose: () => void;
  agentConfigs: AgentConfig[];
  /** 供「链接到画布」子菜单列出可跳转的目标。 */
  canvases: Canvas[];
  activeCanvasId: string;
  /** 沿边重算要按连线走一遍，才知道下游有没有可重算的节点。 */
  edges: { from: string; to: string; id: string; canvasId?: string }[];
  /** AI 或重算正忙时禁用重算入口。 */
  isRecomputeDisabled?: boolean;
  /** 「从模板插入」子菜单的数据源。 */
  templates: CanvasTemplate[];
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
  canvases,
  activeCanvasId,
  edges,
  isRecomputeDisabled = false,
  templates,
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
      const alignModes = [
        ['left', t('canvas.menu.align_left')],
        ['center-h', t('canvas.menu.align_center_h')],
        ['right', t('canvas.menu.align_right')],
        ['top', t('canvas.menu.align_top')],
        ['center-v', t('canvas.menu.align_center_v')],
        ['bottom', t('canvas.menu.align_bottom')],
      ] as const;
      return [
        {
          id: 'multi-layout',
          entries: [
            {
              id: 'align',
              label: t('canvas.menu.align'),
              icon: AlignHorizontalJustifyStart,
              submenu: alignModes.map(([mode, label]) => ({
                id: `align-${mode}`,
                label,
                onSelect: () => actions.alignNodes(nodeIds, mode),
              })),
            },
            {
              id: 'distribute',
              label: t('canvas.menu.distribute'),
              icon: AlignVerticalJustifyStart,
              // 两张卡没有"中间"可分，分布至少要三张
              disabled: nodeIds.length < 3,
              submenu: [
                {
                  id: 'distribute-h',
                  label: t('canvas.menu.distribute_h'),
                  onSelect: () => actions.distributeNodes(nodeIds, 'horizontal'),
                },
                {
                  id: 'distribute-v',
                  label: t('canvas.menu.distribute_v'),
                  onSelect: () => actions.distributeNodes(nodeIds, 'vertical'),
                },
              ],
            },
          ],
        },
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
              id: 'organize',
              label: t('canvas.menu.organize_selected', { count: nodeIds.length }),
              icon: Sparkles,
              accent: true,
              // 两张卡没有"分组"可言；AI 忙时与合成长文同样禁用
              disabled: nodeIds.length < 3 || isSynthesizeDisabled,
              onSelect: () => actions.organizeNodes(nodeIds),
            },
            {
              id: 'set-tags-multi',
              label: t('canvas.menu.set_tags'),
              icon: Tag,
              onSelect: () => actions.setNodeTags(nodeIds),
            },
            {
              id: 'save-template-multi',
              label: t('canvas.menu.save_as_template'),
              icon: LayoutTemplate,
              onSelect: () => actions.saveAsTemplate(nodeIds),
            },
            {
              id: 'present-selection',
              label: t('canvas.presentation.start_here'),
              icon: Play,
              // 右键落点那张卡当起点，只讲选中的这批
              onSelect: () => actions.startPresentation(anchorId, nodeIds),
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
      /*
        沿边重算。两个入口分开给，因为它们回答的是两个不同的问题：
        - 站在一张 AI / 生图卡上：「这张过时了，重新生成」——含自己
        - 站在一张便签上：「我刚改了它，把顺着线的下游都刷一遍」——不含自己
        下游没有可重算节点时不显示，免得给一个点了什么都不会发生的菜单项。
      */
      const hasRecomputableDownstream =
        planRecompute(nodeId, [...nodesById.values()], edges).length > 0;
      if (nodeType === 'ai' || nodeType === 'imagegen') {
        primary.push({
          id: 'regenerate',
          label: t('canvas.menu.regenerate'),
          icon: RefreshCw,
          disabled: isRecomputeDisabled,
          onSelect: () => actions.recomputeFrom(nodeId, true),
        });
      }
      if (hasRecomputableDownstream) {
        primary.push({
          id: 'recompute-downstream',
          label: t('canvas.menu.recompute_downstream'),
          icon: RefreshCw,
          disabled: isRecomputeDisabled,
          onSelect: () => actions.recomputeFrom(nodeId, false),
        });
      }
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
      // 人格接力：有正文可读的卡才有"接着说"的对象
      if (
        agentConfigs.length > 0 &&
        ['note', 'text', 'theme', 'ai', 'web', 'document'].includes(nodeType)
      ) {
        primary.push({
          id: 'relay-to-agent',
          label: t('canvas.menu.relay_to_agent'),
          icon: Bot,
          disabled: isRecomputeDisabled,
          submenu: agentConfigs.map((agent) => ({
            id: `relay-${agent.id}`,
            label: resolveAgentLocalizedName(agent),
            onSelect: () => actions.relayToAgent(nodeId, agent.id),
          })),
        });
      }
      primary.push(
        {
          id: 'set-tags',
          label: t('canvas.menu.set_tags'),
          icon: Tag,
          onSelect: () => actions.setNodeTags([nodeId]),
        },
        {
          id: 'save-template',
          label: t('canvas.menu.save_as_template'),
          icon: LayoutTemplate,
          onSelect: () => actions.saveAsTemplate([nodeId]),
        },
        {
          id: 'present-from-here',
          // 区域框 = 只讲框住的这块（App 侧展开成员）；普通卡 = 从这张讲起
          label: t('canvas.presentation.start_here'),
          icon: Play,
          onSelect: () => actions.startPresentation(nodeId),
        },
        {
          id: 'toggle-select',
          label: isSelected ? t('canvas.menu.unselect') : t('canvas.menu.select'),
          icon: isSelected ? Square : SquareCheckBig,
          onSelect: () => actions.toggleSelect(nodeId),
        },
      );

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

    // 有模板才显示「从模板插入」——空子菜单只会让人纳闷模板从哪来（答案：选中卡片右键存）
    if (templates.length > 0) {
      result.push({
        id: 'templates',
        entries: [
          {
            id: 'insert-template',
            label: t('canvas.menu.insert_template'),
            icon: LayoutTemplate,
            submenu: templates.map((template) => ({
              id: `template-${template.id}`,
              label: template.name,
              onSelect: () => actions.insertTemplate(template.id, at),
            })),
          },
          {
            id: 'rename-template',
            label: t('canvas.menu.rename_template'),
            icon: Pencil,
            submenu: templates.map((template) => ({
              id: `template-ren-${template.id}`,
              label: template.name,
              onSelect: () => actions.renameTemplate(template.id),
            })),
          },
          {
            id: 'delete-template',
            label: t('canvas.menu.delete_template'),
            icon: Trash2,
            submenu: templates.map((template) => ({
              id: `template-del-${template.id}`,
              label: template.name,
              onSelect: () => actions.deleteTemplate(template.id),
            })),
          },
        ],
      });
    }

    // 只有存在别的画布时才给这一项：链接到自己没有意义
    const linkTargets = canvases.filter((c) => c.id !== activeCanvasId);
    if (linkTargets.length > 0) {
      result.push({
        id: 'canvas-links',
        entries: [
          {
            id: 'add-canvas-link',
            label: t('canvas.menu.link_to_canvas'),
            icon: Layers,
            submenu: linkTargets.map((canvas) => ({
              id: `canvas-link-${canvas.id}`,
              label: canvas.name,
              onSelect: () => actions.addCanvasLink(canvas.id, at),
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
          id: 'start-presentation',
          label: t('canvas.presentation.start'),
          icon: Play,
          onSelect: () => actions.startPresentation(),
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
  }, [menu, t, actions, agentConfigs, canvases, activeCanvasId, edges, isRecomputeDisabled, templates, nodesById, selectedNodes, pasteable, isSynthesizeDisabled]);

  return (
    <ContextMenuSurface
      x={menu.screenX}
      y={menu.screenY}
      sections={sections}
      onClose={onClose}
    />
  );
}
