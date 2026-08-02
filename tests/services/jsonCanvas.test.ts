import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  exportCanvasToJsonCanvas,
  importJsonCanvas,
  nodeToJsonCanvas,
  parseJsonCanvas,
  serializeJsonCanvas,
  type JsonCanvasDocument,
} from '../../src/services/jsonCanvas';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  x: 10,
  y: 20,
  ...extra,
});

const edge = (id: string, from: string, to: string): Edge => ({ id, canvasId: 'c1', from, to });

/** 计数器 id，让断言可读；真实调用用的是 crypto.randomUUID。 */
function sequentialIds() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('jsonCanvas', () => {
  describe('导出', () => {
    it('便签变成 text 节点，坐标取整、缺省宽高补齐', () => {
      const [out] = exportCanvasToJsonCanvas([node('n1', { content: '想法', x: 10.4 })], []).nodes;
      expect(out).toMatchObject({ id: 'n1', type: 'text', text: '想法', x: 10, y: 20 });
      expect(out.width).toBeGreaterThan(0);
      expect(out.height).toBeGreaterThan(0);
    });

    it('主题卡的标题、说明、页脚拼成一段 Markdown', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'theme', content: '标题', description: '说明', themeTag: '页脚' })],
        [],
      ).nodes;
      expect(out.text).toBe('# 标题\n\n说明\n\n— 页脚');
    });

    it('AI 卡把追问写成引用块放在回复上方', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'ai', userTurn: '为什么？', content: '因为如此。' })],
        [],
      ).nodes;
      expect(out.text).toBe('> 为什么？\n\n因为如此。');
    });

    it('媒体节点变成 file 节点，写的是相对路径', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'image', filePath: 'media/uploaded/2026/07/a.png' })],
        [],
      ).nodes;
      expect(out).toMatchObject({ type: 'file', file: 'media/uploaded/2026/07/a.png' });
    });

    it('没有 filePath 的老媒体节点退回文本卡，不产出空 file', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'document', content: '正文还在 content 里' })],
        [],
      ).nodes;
      expect(out.type).toBe('text');
      expect(out.file).toBeUndefined();
    });

    it('生图节点取当前显示的那张结果；还没出图时写提示词', () => {
      const withResult = exportCanvasToJsonCanvas(
        [
          node('n1', {
            type: 'imagegen',
            imageGenResults: ['media/generated/b.png', 'media/generated/a.png'],
            imageGenActiveIndex: 1,
          }),
        ],
        [],
      ).nodes[0];
      expect(withResult).toMatchObject({ type: 'file', file: 'media/generated/a.png' });

      const empty = exportCanvasToJsonCanvas(
        [node('n2', { type: 'imagegen', imageGenPrompt: '一只猫' })],
        [],
      ).nodes[0];
      expect(empty).toMatchObject({ type: 'text', text: '一只猫' });
    });

    it('Agent 卡写人设名', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'agent', agentConfigId: 'mirror' })],
        [],
        { agentNameById: (id) => (id === 'mirror' ? '真知镜' : undefined) },
      ).nodes;
      expect(out.text).toBe('真知镜');
    });

    it('连线按 Spoor 的固定端口写 fromSide/toSide 与箭头', () => {
      const [out] = exportCanvasToJsonCanvas([node('a'), node('b')], [edge('e1', 'a', 'b')]).edges;
      expect(out).toEqual({
        id: 'e1',
        fromNode: 'a',
        toNode: 'b',
        fromSide: 'right',
        toSide: 'left',
        toEnd: 'arrow',
      });
    });

    it('端点缺一个的边不导出——别的工具会把它当坏数据', () => {
      const doc = exportCanvasToJsonCanvas([node('a')], [edge('e1', 'a', '已经删掉的节点')]);
      expect(doc.edges).toEqual([]);
    });

    it('Spoor 专有字段放在 spoor 命名空间下，不污染规范字段', () => {
      const [out] = exportCanvasToJsonCanvas(
        [node('n1', { type: 'theme', layout: 2, themeTag: '页脚' })],
        [],
      ).nodes;
      expect(out.spoor).toMatchObject({ type: 'theme', layout: 2, themeTag: '页脚' });
    });

    it('序列化结果是可读的 JSON 且以换行结尾', () => {
      const text = serializeJsonCanvas(exportCanvasToJsonCanvas([node('n1')], []));
      expect(text.endsWith('\n')).toBe(true);
      expect(JSON.parse(text).nodes).toHaveLength(1);
    });
  });

  describe('解析', () => {
    it('不是 JSON、缺 nodes 数组时返回 null', () => {
      expect(parseJsonCanvas('不是 JSON')).toBeNull();
      expect(parseJsonCanvas('{"edges":[]}')).toBeNull();
      expect(parseJsonCanvas('[]')).toBeNull();
    });

    it('缺 edges 时补成空数组', () => {
      expect(parseJsonCanvas('{"nodes":[]}')).toEqual({ nodes: [], edges: [] });
    });
  });

  describe('导入', () => {
    it('一律新发 id，不沿用文件里的——否则会覆盖画布上已有的卡片', () => {
      const doc: JsonCanvasDocument = {
        nodes: [{ id: '撞车的 id', type: 'text', x: 0, y: 0, width: 100, height: 100, text: '甲' }],
        edges: [],
      };
      const { nodes } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(nodes[0].id).toBe('new-1');
      expect(nodes[0].canvasId).toBe('c9');
    });

    it('连线跟着重映射到新 id', () => {
      const doc: JsonCanvasDocument = {
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '甲' },
          { id: 'b', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '乙' },
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
      };
      const { nodes, edges } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(edges[0]).toMatchObject({ from: nodes[0].id, to: nodes[1].id, canvasId: 'c9' });
    });

    it('指向不存在节点的连线直接丢掉', () => {
      const doc: JsonCanvasDocument = {
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '甲' }],
        edges: [{ id: 'e', fromNode: 'a', toNode: '不存在' }],
      };
      expect(importJsonCanvas(doc, 'c9', sequentialIds()).edges).toEqual([]);
    });

    it('file 节点按扩展名分成图片 / 视频 / 文档', () => {
      const doc: JsonCanvasDocument = {
        nodes: [
          { id: '1', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a/b.png' },
          { id: '2', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a/b.mp4' },
          { id: '3', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a/b.md' },
        ],
        edges: [],
      };
      const { nodes } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(nodes.map((n) => n.type)).toEqual(['image', 'video', 'document']);
      expect(nodes[0].filePath).toBe('a/b.png');
      expect(nodes[0].fileName).toBe('b.png');
    });

    it('link 节点落成网页卡片，不再降级（0.3.1 起有 web 节点）', () => {
      const doc: JsonCanvasDocument = {
        nodes: [
          { id: '1', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://example.com' },
        ],
        edges: [],
      };
      const { nodes, degraded } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(nodes[0]).toMatchObject({ type: 'web', url: 'https://example.com' });
      expect(degraded.links).toBe(0);
    });

    it('group 节点落成区域框，不再降级（0.3.1 起有 frame）', () => {
      const doc: JsonCanvasDocument = {
        nodes: [{ id: '1', type: 'group', x: 0, y: 0, width: 600, height: 400, label: '第一章' }],
        edges: [],
      };
      const { nodes, degraded } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(nodes[0]).toMatchObject({ type: 'frame', content: '第一章' });
      expect(degraded.groups).toBe(0);
    });

    it('tags 与色板外观随导出走一圈不丢；bg 映射到规范的 color', () => {
      const source: CanvasNode = {
        id: 'n1',
        canvasId: 'c1',
        type: 'text',
        content: '有标签的卡',
        x: 0,
        y: 0,
        tags: ['重要', '待办'],
        styleOverrides: { bg: '#fef3c7', text: '#92400e' },
      };
      const exported = nodeToJsonCanvas(source);
      expect(exported.color).toBe('#fef3c7');
      expect(exported.spoor?.tags).toEqual(['重要', '待办']);

      const { nodes } = importJsonCanvas({ nodes: [exported], edges: [] }, 'c9', sequentialIds());
      expect(nodes[0].tags).toEqual(['重要', '待办']);
      expect(nodes[0].styleOverrides).toEqual({ bg: '#fef3c7', text: '#92400e' });
    });

    it('外部工具只写了 color 时，导入把 hex 当背景色', () => {
      const { nodes } = importJsonCanvas(
        {
          nodes: [{ id: '1', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'hi', color: '#1e293b' }],
          edges: [],
        },
        'c9',
        sequentialIds(),
      );
      expect(nodes[0].styleOverrides).toEqual({ bg: '#1e293b' });

      // "1"-"6" 预设色号对应不到具体色值，不硬猜
      const { nodes: preset } = importJsonCanvas(
        {
          nodes: [{ id: '1', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'hi', color: '4' }],
          edges: [],
        },
        'c9',
        sequentialIds(),
      );
      expect(preset[0].styleOverrides).toBeUndefined();
    });

    it('字段坏掉的行跳过并计数，不影响其余的行', () => {
      const doc = {
        nodes: [
          { id: '1', type: 'text', x: 'NaN', y: 0, text: '坐标坏了' },
          { type: 'text', x: 0, y: 0, text: '没有 id' },
          { id: '3', type: '未来的新类型', x: 0, y: 0 },
          { id: '4', type: 'text', x: 0, y: 0, text: '好的' },
        ],
      } as unknown as JsonCanvasDocument;
      const { nodes, degraded } = importJsonCanvas(
        { ...doc, edges: [] },
        'c9',
        sequentialIds(),
      );
      expect(nodes).toHaveLength(1);
      expect(nodes[0].content).toBe('好的');
      expect(degraded.skipped).toBe(3);
    });

    it('带 spoor 扩展字段时还原原始类型与版式', () => {
      const original = [
        node('n1', { type: 'theme', content: '标题', description: '说明', themeTag: '页脚', layout: 3 }),
        node('n2', { type: 'agent', agentConfigId: 'mirror' }),
      ];
      const doc = exportCanvasToJsonCanvas(original, [], { agentNameById: () => '真知镜' });
      const { nodes } = importJsonCanvas(doc, 'c9', sequentialIds());

      expect(nodes[0]).toMatchObject({
        type: 'theme',
        description: '说明',
        themeTag: '页脚',
        layout: 3,
      });
      expect(nodes[1]).toMatchObject({ type: 'agent', agentConfigId: 'mirror' });
    });

    it('生图节点导出成结果图后，导回来是一张图片卡', () => {
      const doc = exportCanvasToJsonCanvas(
        [node('n1', { type: 'imagegen', imageGenResults: ['media/generated/a.png'] })],
        [],
      );
      const { nodes } = importJsonCanvas(doc, 'c9', sequentialIds());
      expect(nodes[0]).toMatchObject({ type: 'image', filePath: 'media/generated/a.png' });
    });

    it('往返一遍，节点数、连线数与正文都对得上', () => {
      const original = [node('a', { content: '甲' }), node('b', { content: '乙', x: 400 })];
      const doc = exportCanvasToJsonCanvas(original, [edge('e1', 'a', 'b')]);
      const round = importJsonCanvas(
        parseJsonCanvas(serializeJsonCanvas(doc))!,
        'c9',
        sequentialIds(),
      );

      expect(round.nodes.map((n) => n.content)).toEqual(['甲', '乙']);
      expect(round.nodes.map((n) => [n.x, n.y])).toEqual([
        [10, 20],
        [400, 20],
      ]);
      expect(round.edges).toHaveLength(1);
      expect(round.degraded).toEqual({ links: 0, groups: 0, skipped: 0 });
    });
  });
});
