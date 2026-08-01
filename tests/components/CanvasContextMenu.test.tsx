import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AgentConfig, Canvas, CanvasNode } from '../../src/db';
import {
  CanvasContextMenu,
  type CanvasContextMenuActions,
} from '../../src/components/canvas/CanvasContextMenu';
import type { CanvasContextMenuState } from '../../src/hooks/useCanvasContextMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      const raw =
        ({
        'sidebar.new_note': '新建便签',
        'sidebar.new_theme_card': '新建主题卡',
        'canvas.menu.insert_image': '插入图片…',
        'canvas.menu.insert_video': '插入视频…',
        'canvas.menu.insert_document': '插入文档…',
        'canvas.menu.add_agent': '添加助手',
        'canvas.menu.paste': '粘贴',
        'canvas.menu.reset_view': '重置视图',
        'canvas.menu.edit_content': '编辑内容',
        'canvas.menu.duplicate': '创建副本',
        'canvas.menu.start_link': '开始连线',
        'canvas.menu.select': '选中',
        'canvas.menu.unselect': '取消选中',
        'canvas.menu.delete_node': '删除节点',
        'canvas.menu.delete_edge': '删除连线',
        'canvas.menu.save_as': '另存为…',
          'canvas.menu.clear_selection': '全部取消选中',
          'canvas.menu.link_all_to_this': '全部连到此节点（{{count}} 条）',
          'canvas.menu.synthesize_selected': '合成长文（{{count}} 张）',
          'canvas.menu.delete_selected': '批量删除（{{count}} 张）',
        }[key] ?? key);
      return opts?.count === undefined ? raw : raw.replace('{{count}}', String(opts.count));
    },
  }),
}));

let tauriRuntime = true;
vi.mock('../../src/utils/isTauriRuntime', () => ({
  isTauriRuntime: () => tauriRuntime,
}));

vi.mock('../../src/utils/aiI18n', () => ({
  resolveAgentLocalizedName: (agent: { name: string }) => agent.name,
}));

function makeActions(): CanvasContextMenuActions {
  return {
    createNode: vi.fn(),
    insertFile: vi.fn(),
    addAgentNode: vi.fn(),
    addCanvasLink: vi.fn(),
    recomputeFrom: vi.fn(),
    pasteNodes: vi.fn(),
    resetView: vi.fn(),
    editNode: vi.fn(),
    duplicateNode: vi.fn(),
    startLink: vi.fn(),
    toggleSelect: vi.fn(),
    deleteNode: vi.fn(),
    deleteEdge: vi.fn(),
    linkNodesToHub: vi.fn(),
    synthesizeSelected: vi.fn(),
    clearSelection: vi.fn(),
    deleteNodes: vi.fn(),
    outputAsImageNode: vi.fn(),
    saveNodeMediaAs: vi.fn(),
    createNodeLinkedFrom: vi.fn(),
    insertFileLinkedFrom: vi.fn(),
  };
}

const AGENTS: AgentConfig[] = [
  { id: 'a1', name: '真知镜', role: 'r', prompt: 'p' },
  { id: 'a2', name: '编织者', role: 'r', prompt: 'p' },
];

function makeMenu(target: CanvasContextMenuState['target']): CanvasContextMenuState {
  return { screenX: 200, screenY: 150, canvasX: 40, canvasY: 25, target };
}

function nodesMap(nodes: CanvasNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

function renderMenu({
  target,
  nodes = [],
  selected = new Set<string>(),
  agents = AGENTS,
  actions = makeActions(),
  onClose = vi.fn(),
  isSynthesizeDisabled = false,
  canvases = [],
  activeCanvasId = 'c1',
}: {
  target: CanvasContextMenuState['target'];
  nodes?: CanvasNode[];
  selected?: Set<string>;
  agents?: AgentConfig[];
  actions?: CanvasContextMenuActions;
  onClose?: () => void;
  isSynthesizeDisabled?: boolean;
  canvases?: Canvas[];
  activeCanvasId?: string;
}) {
  render(
    <CanvasContextMenu
      menu={makeMenu(target)}
      onClose={onClose}
      agentConfigs={agents}
      canvases={canvases}
      activeCanvasId={activeCanvasId}
      edges={[]}
      nodesById={nodesMap(nodes)}
      selectedNodes={selected}
      actions={actions}
      isSynthesizeDisabled={isSynthesizeDisabled}
    />,
  );
  return { actions, onClose };
}

function labels() {
  return screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
}

describe('CanvasContextMenu', () => {
  beforeEach(() => {
    // 让「粘贴便签」默认处于禁用态，除非用例自己塞入可用负载。
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
  });

  describe('空白处', () => {
    it('列出新建、插入、助手、杂项四组', () => {
      renderMenu({ target: { kind: 'canvas' } });
      expect(labels()).toEqual([
        '新建便签',
        '新建主题卡',
        'imagegen.new_node',
        'nodes.web_new_node',
        'nodes.frame_new_node',
        '插入图片…',
        '插入视频…',
        '插入文档…',
        '添加助手',
        '粘贴',
        '重置视图',
      ]);
    });

    it('不出现「新建文本」（与便签同为 text 类型，会是重复项）', () => {
      renderMenu({ target: { kind: 'canvas' } });
      expect(screen.queryByText('新建文本')).toBeNull();
    });

    it('新建便签用右键处的画布坐标建 text 节点', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('新建便签'));
      expect(actions.createNode).toHaveBeenCalledWith('text', { x: 40, y: 25 });
    });

    it('新建主题卡建 theme 节点', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('新建主题卡'));
      expect(actions.createNode).toHaveBeenCalledWith('theme', { x: 40, y: 25 });
    });

    it('插入图片带上对应的 accept 与落点', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('插入图片…'));
      expect(actions.insertFile).toHaveBeenCalledWith('image/*', { x: 40, y: 25 });
    });

    it('插入文档的 accept 覆盖 docx/txt/md', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('插入文档…'));
      expect(actions.insertFile).toHaveBeenCalledWith('.pdf,.docx,.txt,.md', { x: 40, y: 25 });
    });

    it('助手为二级菜单，悬停后列出全部人设', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      const entry = screen.getByText('添加助手').closest('button')!;
      expect(entry).toHaveAttribute('aria-haspopup', 'menu');

      fireEvent.pointerEnter(entry);
      expect(screen.getByText('真知镜')).toBeInTheDocument();
      expect(screen.getByText('编织者')).toBeInTheDocument();

      fireEvent.pointerDown(screen.getByText('编织者'));
      expect(actions.addAgentNode).toHaveBeenCalledWith('a2', { x: 40, y: 25 });
    });

    it('没有人设时不显示助手项', () => {
      renderMenu({ target: { kind: 'canvas' }, agents: [] });
      expect(screen.queryByText('添加助手')).toBeNull();
    });

    it('剪贴板不可读时「粘贴便签」保持禁用', () => {
      renderMenu({ target: { kind: 'canvas' } });
      expect(screen.getByText('粘贴').closest('button')).toBeDisabled();
    });

    it('剪贴板有画布负载时「粘贴」可用并按右键处落点粘贴', async () => {
      const payload = {
        kind: 'spoor-canvas-v2',
        nodes: [{ sourceId: 's1', node: { type: 'text', content: 'hi', x: 5, y: 5 } }],
        edges: [],
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: vi.fn().mockResolvedValue(JSON.stringify(payload)) },
      });

      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      const btn = await screen.findByText('粘贴');
      await vi.waitFor(() => expect(btn.closest('button')).not.toBeDisabled());

      fireEvent.pointerDown(btn);
      expect(actions.pasteNodes).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'spoor-canvas-v2' }),
        { x: 40, y: 25 },
      );
    });

    it('重置视图', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('重置视图'));
      expect(actions.resetView).toHaveBeenCalled();
    });
  });

  describe('节点上', () => {
    const noteNode: CanvasNode = { id: 'n1', type: 'text', x: 0, y: 0 };
    const imageNode: CanvasNode = { id: 'n2', type: 'image', x: 0, y: 0 };
    const aiNode: CanvasNode = { id: 'n3', type: 'ai', x: 0, y: 0 };

    it('便签：编辑/副本/连线/版式/选中/删除', () => {
      renderMenu({ target: { kind: 'node', nodeId: 'n1' }, nodes: [noteNode] });
      expect(labels()).toEqual([
        '编辑内容',
        '创建副本',
        '开始连线',
        '选中',
        '删除节点',
      ]);
    });

    it('图片节点没有「编辑内容」', () => {
      renderMenu({ target: { kind: 'node', nodeId: 'n2' }, nodes: [imageNode] });
      expect(screen.queryByText('编辑内容')).toBeNull();
      expect(screen.getByText('创建副本')).toBeInTheDocument();
    });

    it('AI 卡可编辑但不参与版式轮换', () => {
      renderMenu({ target: { kind: 'node', nodeId: 'n3' }, nodes: [aiNode] });
      expect(screen.getByText('编辑内容')).toBeInTheDocument();
    });

    it('已选中的节点显示「取消选中」', () => {
      renderMenu({
        target: { kind: 'node', nodeId: 'n1' },
        nodes: [noteNode],
        selected: new Set(['n1']),
      });
      expect(screen.getByText('取消选中')).toBeInTheDocument();
      expect(screen.queryByText('选中')).toBeNull();
    });

    it.each([
      ['编辑内容', 'editNode'],
      ['创建副本', 'duplicateNode'],
      ['开始连线', 'startLink'],
      ['选中', 'toggleSelect'],
      ['删除节点', 'deleteNode'],
    ] as const)('%s 调用 %s', (label, action) => {
      const { actions } = renderMenu({ target: { kind: 'node', nodeId: 'n1' }, nodes: [noteNode] });
      fireEvent.pointerDown(screen.getByText(label));
      expect(actions[action]).toHaveBeenCalledWith('n1');
    });

    it('删除节点为危险样式', () => {
      renderMenu({ target: { kind: 'node', nodeId: 'n1' }, nodes: [noteNode] });
      expect(screen.getByText('删除节点').closest('button')!.className).toContain('text-red-700');
    });
  });

  describe('多选（≥2 张）', () => {
    const target: CanvasContextMenuState['target'] = {
      kind: 'nodes',
      nodeIds: ['n1', 'n2', 'n3'],
      anchorId: 'n2',
    };

    it('只给批量操作，不混入单节点项', () => {
      renderMenu({ target, selected: new Set(target.nodeIds) });
      expect(labels()).toEqual([
        '全部连到此节点（2 条）',
        '合成长文（3 张）',
        '全部取消选中',
        '批量删除（3 张）',
      ]);
      expect(screen.queryByText('编辑内容')).toBeNull();
      expect(screen.queryByText('创建副本')).toBeNull();
    });

    it('连线数是选中数减一（中心节点不连自己）', () => {
      renderMenu({
        target: { kind: 'nodes', nodeIds: ['a', 'b'], anchorId: 'a' },
        selected: new Set(['a', 'b']),
      });
      expect(screen.getByText('全部连到此节点（1 条）')).toBeInTheDocument();
    });

    it('全部连到被右键的那个节点（anchor 作为中心）', () => {
      const { actions } = renderMenu({ target, selected: new Set(target.nodeIds) });
      fireEvent.pointerDown(screen.getByText('全部连到此节点（2 条）'));
      expect(actions.linkNodesToHub).toHaveBeenCalledWith(['n1', 'n2', 'n3'], 'n2');
    });

    it('合成长文', () => {
      const { actions } = renderMenu({ target, selected: new Set(target.nodeIds) });
      fireEvent.pointerDown(screen.getByText('合成长文（3 张）'));
      expect(actions.synthesizeSelected).toHaveBeenCalled();
    });

    it('AI 忙时禁用合成长文', () => {
      const { actions } = renderMenu({
        target,
        selected: new Set(target.nodeIds),
        isSynthesizeDisabled: true,
      });
      const btn = screen.getByText('合成长文（3 张）').closest('button')!;
      expect(btn).toBeDisabled();
      fireEvent.pointerDown(btn);
      expect(actions.synthesizeSelected).not.toHaveBeenCalled();
    });

    it('全部取消选中', () => {
      const { actions } = renderMenu({ target, selected: new Set(target.nodeIds) });
      fireEvent.pointerDown(screen.getByText('全部取消选中'));
      expect(actions.clearSelection).toHaveBeenCalled();
    });

    it('批量删除传全部选中 id 且为危险样式', () => {
      const { actions } = renderMenu({ target, selected: new Set(target.nodeIds) });
      const btn = screen.getByText('批量删除（3 张）').closest('button')!;
      expect(btn.className).toContain('text-red-700');

      fireEvent.pointerDown(btn);
      expect(actions.deleteNodes).toHaveBeenCalledWith(['n1', 'n2', 'n3']);
    });
  });

  describe('连线上', () => {
    it('只有删除连线一项', () => {
      renderMenu({ target: { kind: 'edge', edgeId: 'e1' } });
      expect(labels()).toEqual(['删除连线']);
    });

    it('删除指定连线', () => {
      const { actions } = renderMenu({ target: { kind: 'edge', edgeId: 'e1' } });
      fireEvent.pointerDown(screen.getByText('删除连线'));
      expect(actions.deleteEdge).toHaveBeenCalledWith('e1');
    });
  });

  describe('通用行为', () => {
    it('选中一项后关闭菜单', () => {
      const { onClose } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('重置视图'));
      expect(onClose).toHaveBeenCalled();
    });

    it('点开二级菜单入口本身不关闭菜单', () => {
      const { onClose } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('添加助手'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('渲染到 body 且为 fixed 定位（不被画布 transform 缩放）', () => {
      renderMenu({ target: { kind: 'canvas' } });
      const panel = screen.getAllByRole('menu')[0];
      expect(document.body.contains(panel)).toBe(true);
      expect(panel).toHaveClass('fixed');
    });

    it('点击菜单以外区域收起', () => {
      const { onClose } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(document.body);
      expect(onClose).toHaveBeenCalled();
    });

    it('点击菜单内部不收起', () => {
      const { onClose } = renderMenu({ target: { kind: 'canvas' } });
      const panel = screen.getAllByRole('menu')[0];
      fireEvent.pointerDown(within(panel).getByText('重置视图'));
      // 由「选中即关闭」触发一次，而不是被外部点击逻辑误杀
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('方向键 + 回车可选中', () => {
      const { actions } = renderMenu({ target: { kind: 'canvas' } });
      const panel = screen.getAllByRole('menu')[0];

      fireEvent.keyDown(panel, { key: 'ArrowDown' });
      fireEvent.keyDown(panel, { key: 'Enter' });
      expect(actions.createNode).toHaveBeenCalledWith('text', { x: 40, y: 25 });
    });

    it('Escape 收起', () => {
      const { onClose } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.keyDown(screen.getAllByRole('menu')[0], { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('禁用项点击无效', () => {
      const { actions, onClose } = renderMenu({ target: { kind: 'canvas' } });
      fireEvent.pointerDown(screen.getByText('粘贴'));
      expect(actions.pasteNodes).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
  describe('另存为', () => {
    it('图片节点有 filePath 时出现', () => {
      renderMenu({
        target: { kind: 'node', nodeId: 'img' },
        nodes: [{ id: 'img', type: 'image', x: 0, y: 0, filePath: 'media/uploaded/a.png' } as CanvasNode],
      });
      expect(screen.getByText('另存为…')).toBeInTheDocument();
    });

    it('图片只有旧 data URL（不在文件存储里）时不出现', () => {
      renderMenu({
        target: { kind: 'node', nodeId: 'img' },
        nodes: [{ id: 'img', type: 'image', x: 0, y: 0, content: 'data:image/png;base64,X' } as CanvasNode],
      });
      expect(screen.queryByText('另存为…')).toBeNull();
    });

    it('生图节点有结果时出现，没结果时不出现', () => {
      renderMenu({
        target: { kind: 'node', nodeId: 'gen' },
        nodes: [{ id: 'gen', type: 'imagegen', x: 0, y: 0, imageGenResults: ['media/generated/a.png'] } as CanvasNode],
      });
      expect(screen.getByText('另存为…')).toBeInTheDocument();

      cleanup();
      renderMenu({
        target: { kind: 'node', nodeId: 'gen' },
        nodes: [{ id: 'gen', type: 'imagegen', x: 0, y: 0 } as CanvasNode],
      });
      expect(screen.queryByText('另存为…')).toBeNull();
    });

    it('便签没有原件，不出现', () => {
      renderMenu({
        target: { kind: 'node', nodeId: 'n1' },
        nodes: [{ id: 'n1', type: 'text', x: 0, y: 0 } as CanvasNode],
      });
      expect(screen.queryByText('另存为…')).toBeNull();
    });

    it('浏览器下没有文件存储，一律不出现', () => {
      tauriRuntime = false;
      try {
        renderMenu({
          target: { kind: 'node', nodeId: 'img' },
          nodes: [{ id: 'img', type: 'image', x: 0, y: 0, filePath: 'media/uploaded/a.png' } as CanvasNode],
        });
        expect(screen.queryByText('另存为…')).toBeNull();
      } finally {
        tauriRuntime = true;
      }
    });

    it('点击后带节点 id 回调', () => {
      const actions = makeActions();
      renderMenu({
        target: { kind: 'node', nodeId: 'img' },
        nodes: [{ id: 'img', type: 'image', x: 0, y: 0, filePath: 'media/uploaded/a.png' } as CanvasNode],
        actions,
      });
      fireEvent.pointerDown(screen.getByText('另存为…'));
      expect(actions.saveNodeMediaAs).toHaveBeenCalledWith('img');
    });
  });

  describe('link-drop（连线拖到空白处）', () => {
    it('给出建卡与插入文件两组，且不含节点操作项', () => {
      renderMenu({ target: { kind: 'link-drop', fromId: 'src' } });
      expect(screen.getByText('新建便签')).toBeInTheDocument();
      expect(screen.getByText('插入图片…')).toBeInTheDocument();
      expect(screen.queryByText('重置视图')).toBeNull();
      expect(screen.queryByText('粘贴便签')).toBeNull();
    });

    it('选建卡时带上源节点 id 与落点', () => {
      const actions = makeActions();
      renderMenu({ target: { kind: 'link-drop', fromId: 'src' }, actions });
      fireEvent.pointerDown(screen.getByText('新建便签'));
      expect(actions.createNodeLinkedFrom).toHaveBeenCalledWith('text', { x: 40, y: 25 }, 'src');
    });

    it('选插入文件时同样带上源节点 id', () => {
      const actions = makeActions();
      renderMenu({ target: { kind: 'link-drop', fromId: 'src' }, actions });
      fireEvent.pointerDown(screen.getByText('插入图片…'));
      expect(actions.insertFileLinkedFrom).toHaveBeenCalledWith('image/*', { x: 40, y: 25 }, 'src');
    });
  });

});
