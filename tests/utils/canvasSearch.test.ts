import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  buildSnippet,
  nodeSearchFields,
  searchCanvasNodes,
  stepSearchIndex,
} from '../../src/utils/canvasSearch';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  x: 0,
  y: 0,
  ...extra,
});

describe('canvasSearch', () => {
  it('空查询不返回任何命中（否则一打开搜索框整张画布都被选中）', () => {
    expect(searchCanvasNodes([node('n1', { content: '随便什么' })], '')).toEqual([]);
    expect(searchCanvasNodes([node('n1', { content: '随便什么' })], '   ')).toEqual([]);
  });

  it('搜正文、主题说明、页脚、文件名与生图提示词', () => {
    const nodes = [
      node('正文', { content: '关于独立创作者的想法' }),
      node('说明', { type: 'theme', description: '这是主题说明' }),
      node('页脚', { type: 'theme', themeTag: '空间编码' }),
      node('文件', { type: 'document', fileName: '年度报告.docx' }),
      node('提示词', { type: 'imagegen', imageGenPrompt: '一只在雨里的猫' }),
    ];

    expect(searchCanvasNodes(nodes, '创作者').map((m) => m.nodeId)).toEqual(['正文']);
    expect(searchCanvasNodes(nodes, '主题说明').map((m) => m.nodeId)).toEqual(['说明']);
    expect(searchCanvasNodes(nodes, '空间').map((m) => m.nodeId)).toEqual(['页脚']);
    expect(searchCanvasNodes(nodes, '年度报告').map((m) => m.nodeId)).toEqual(['文件']);
    expect(searchCanvasNodes(nodes, '雨里的猫').map((m) => m.nodeId)).toEqual(['提示词']);
  });

  it('英文不区分大小写', () => {
    const nodes = [node('n1', { type: 'document', fileName: 'Quarterly-REPORT.docx' })];
    expect(searchCanvasNodes(nodes, 'quarterly-report')).toHaveLength(1);
  });

  it('Agent 卡没有正文，靠人设名命中', () => {
    const nodes = [node('agent', { type: 'agent', agentConfigId: 'mirror' })];
    const options = { agentNameById: (id?: string) => (id === 'mirror' ? '真知镜' : undefined) };

    expect(searchCanvasNodes(nodes, '真知镜', options).map((m) => m.nodeId)).toEqual(['agent']);
    expect(searchCanvasNodes(nodes, '真知镜')).toEqual([]);
  });

  it('保持传入顺序，并带上节点所属画布', () => {
    const matches = searchCanvasNodes(
      [
        node('n1', { content: '甲 关键词' }),
        node('n2', { content: '无关' }),
        node('n3', { content: '丙 关键词', canvasId: undefined }),
      ],
      '关键词',
    );
    expect(matches.map((m) => m.nodeId)).toEqual(['n1', 'n3']);
    // 旧数据没有 canvasId，按 default 归属，和 App 的过滤口径一致
    expect(matches[1].canvasId).toBe('default');
  });

  describe('摘要', () => {
    it('从命中处向两侧各截一段，两头用省略号标出', () => {
      const long = `${'左'.repeat(80)}命中${'右'.repeat(80)}`;
      const snippet = buildSnippet(long, '命中', 5);
      expect(snippet).toBe('…左左左左左命中右右右右右…');
    });

    it('短文本原样返回，不加省略号', () => {
      expect(buildSnippet('就这么点字', '这么')).toBe('就这么点字');
    });

    it('换行与连续空白折成单个空格，列表里不至于炸开', () => {
      expect(buildSnippet('第一行\n\n  第二行', '第二行')).toBe('第一行 第二行');
    });
  });

  describe('结果间循环', () => {
    it('走到头绕回开头，走到开头之前绕到末尾', () => {
      expect(stepSearchIndex(0, 3, 1)).toBe(1);
      expect(stepSearchIndex(2, 3, 1)).toBe(0);
      expect(stepSearchIndex(0, 3, -1)).toBe(2);
    });

    it('没有命中时恒为 0', () => {
      expect(stepSearchIndex(5, 0, 1)).toBe(0);
    });
  });

  it('nodeSearchFields 丢掉空字段', () => {
    expect(nodeSearchFields(node('n1', { content: '有字', description: '   ' }))).toEqual(['有字']);
  });
});
