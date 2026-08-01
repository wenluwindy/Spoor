import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  ROW_TOLERANCE_PX,
  allocateAssetNames,
  canvasToMarkdown,
  nodeLabel,
  sortNodesForReading,
} from '../../src/services/canvasMarkdown';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  x: 0,
  y: 0,
  ...extra,
});

const OPTIONS = { canvasName: '测试画布', exportedAt: new Date(2026, 7, 1, 9, 30) };

describe('canvasMarkdown', () => {
  describe('阅读顺序', () => {
    it('从上到下，同一行从左到右', () => {
      const ordered = sortNodesForReading([
        node('右上', { x: 300, y: 0 }),
        node('下', { x: 0, y: 500 }),
        node('左上', { x: 0, y: 0 }),
      ]);
      expect(ordered.map((n) => n.id)).toEqual(['左上', '右上', '下']);
    });

    it('y 差在容差内算同一行——肉眼齐平的两张卡不该被排成上下两段', () => {
      const ordered = sortNodesForReading([
        node('右', { x: 400, y: 0 }),
        node('左', { x: 0, y: ROW_TOLERANCE_PX - 1 }),
      ]);
      expect(ordered.map((n) => n.id)).toEqual(['左', '右']);
    });

    it('超出容差就按上下排，哪怕右边那张更靠左', () => {
      const ordered = sortNodesForReading([
        node('下', { x: 0, y: ROW_TOLERANCE_PX + 1 }),
        node('上', { x: 400, y: 0 }),
      ]);
      expect(ordered.map((n) => n.id)).toEqual(['上', '下']);
    });
  });

  describe('正文', () => {
    it('开头是画布名与导出时间', () => {
      const md = canvasToMarkdown([node('n1', { content: '甲' })], [], OPTIONS);
      expect(md).toContain('# 测试画布');
      expect(md).toContain('1 nodes');
    });

    it('便签之间用分隔线断开', () => {
      const md = canvasToMarkdown(
        [node('n1', { content: '甲' }), node('n2', { content: '乙', y: 200 })],
        [],
        OPTIONS,
      );
      expect(md).toContain('甲\n\n---\n\n乙');
    });

    it('主题卡写成二级标题加说明与斜体页脚', () => {
      const md = canvasToMarkdown(
        [node('n1', { type: 'theme', content: '标题', description: '说明', themeTag: '页脚' })],
        [],
        OPTIONS,
      );
      expect(md).toContain('## 标题');
      expect(md).toContain('说明');
      expect(md).toContain('*页脚*');
    });

    it('AI 卡把追问写成引用块', () => {
      const md = canvasToMarkdown(
        [node('n1', { type: 'ai', userTurn: '为什么？', content: '因为如此。' })],
        [],
        OPTIONS,
      );
      expect(md).toContain('> 为什么？\n\n因为如此。');
    });

    it('图片写成相对链接，指向包里的 assets/', () => {
      const md = canvasToMarkdown(
        [node('n1', { type: 'image', filePath: 'media/uploaded/a.png', fileName: '照片.png' })],
        [],
        { ...OPTIONS, assetNameByPath: new Map([['media/uploaded/a.png', 'a.png']]) },
      );
      expect(md).toContain('![照片.png](assets/a.png)');
    });

    it('没给资产映射时不写死链接', () => {
      const md = canvasToMarkdown(
        [node('n1', { type: 'image', filePath: 'media/uploaded/a.png', fileName: '照片.png' })],
        [],
        OPTIONS,
      );
      expect(md).not.toContain('assets/');
      expect(md).toContain('*照片.png*');
    });

    it('docx 正文是 HTML，不往 Markdown 里贴标签', () => {
      const md = canvasToMarkdown(
        [
          node('n1', {
            type: 'document',
            fileType: 'docx',
            fileName: '报告.docx',
            content: '<p>一堆标签</p>',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(md).toContain('**报告.docx**');
      expect(md).not.toContain('<p>');
    });

    it('Agent 卡写人设名', () => {
      const md = canvasToMarkdown([node('n1', { type: 'agent', agentConfigId: 'mirror' })], [], {
        ...OPTIONS,
        agentNameById: (id) => (id === 'mirror' ? '真知镜' : undefined),
      });
      expect(md).toContain('**真知镜**');
    });

    it('空节点不留下空段落', () => {
      const md = canvasToMarkdown(
        [node('n1', { content: '' }), node('n2', { content: '有字', y: 200 })],
        [],
        OPTIONS,
      );
      expect(md).not.toContain('---\n\n---');
    });
  });

  describe('连线附录', () => {
    it('单列一节，用卡片序号与摘要指代', () => {
      const nodes = [node('a', { content: '第一张' }), node('b', { content: '第二张', y: 300 })];
      const edges: Edge[] = [{ id: 'e1', canvasId: 'c1', from: 'a', to: 'b' }];
      const md = canvasToMarkdown(nodes, edges, OPTIONS);
      expect(md).toContain('- #1 第一张 → #2 第二张');
    });

    it('没有连线时不留空节', () => {
      const md = canvasToMarkdown([node('a', { content: '甲' })], [], OPTIONS);
      expect(md).not.toContain('## ⇢');
    });

    it('端点不在导出范围里的连线不写进附录', () => {
      const md = canvasToMarkdown(
        [node('a', { content: '甲' })],
        [{ id: 'e1', canvasId: 'c1', from: 'a', to: '别处的节点' }],
        OPTIONS,
      );
      expect(md).not.toContain('## ⇢');
    });

    it('长标题截断，附录不会被一整段正文撑爆', () => {
      const label = nodeLabel(node('n1', { content: '一'.repeat(50) }), 0);
      expect(label.length).toBeLessThan(35);
      expect(label.endsWith('…')).toBe(true);
    });

    it('没有正文的卡片用序号指代', () => {
      expect(nodeLabel(node('n1'), 2)).toBe('#3');
    });
  });

  describe('资产命名', () => {
    it('用原文件名', () => {
      expect(allocateAssetNames(['media/uploaded/2026/07/a.png']).get('media/uploaded/2026/07/a.png')).toBe(
        'a.png',
      );
    });

    it('不同目录下的同名文件补序号，不让后一张覆盖前一张', () => {
      const names = allocateAssetNames(['x/a.png', 'y/a.png', 'z/a.png']);
      expect([...names.values()]).toEqual(['a.png', 'a-2.png', 'a-3.png']);
    });

    it('大小写不同也算撞车——Windows 上它们是同一个文件', () => {
      const names = allocateAssetNames(['x/A.png', 'y/a.png']);
      expect([...names.values()]).toEqual(['A.png', 'a-2.png']);
    });

    it('没有扩展名也能处理', () => {
      const names = allocateAssetNames(['x/data', 'y/data']);
      expect([...names.values()]).toEqual(['data', 'data-2']);
    });
  });
});
