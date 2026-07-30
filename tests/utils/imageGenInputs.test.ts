import { describe, it, expect } from 'vitest';
import {
  MAX_REF_IMAGES,
  buildImageGenPrompt,
  collectImageGenInputs,
  neighborIdsOf,
  refSpecOf,
} from '../../src/utils/imageGenInputs';
import type { CanvasNode } from '../../src/db';

function node(over: Partial<CanvasNode> & { id: string; type: string }): CanvasNode {
  return { x: 0, y: 0, ...over };
}

const edge = (from: string, to: string) => ({ from, to });

describe('neighborIdsOf', () => {
  it('无向：两个方向都算邻居', () => {
    const edges = [edge('a', 'b'), edge('c', 'a')];
    expect(neighborIdsOf('a', edges).sort()).toEqual(['b', 'c']);
  });

  it('去重', () => {
    expect(neighborIdsOf('a', [edge('a', 'b'), edge('b', 'a')])).toEqual(['b']);
  });

  it('自环不算自己的邻居', () => {
    expect(neighborIdsOf('a', [edge('a', 'a')])).toEqual([]);
  });

  it('没有连线时返回空', () => {
    expect(neighborIdsOf('a', [])).toEqual([]);
  });
});

describe('refSpecOf', () => {
  it('图片节点优先 filePath', () => {
    expect(refSpecOf(node({ id: 'i', type: 'image', filePath: 'media/a.png', content: 'data:x' })))
      .toBe('media/a.png');
  });

  it('图片节点回退旧的 content', () => {
    expect(refSpecOf(node({ id: 'i', type: 'image', content: 'data:image/png;base64,X' })))
      .toBe('data:image/png;base64,X');
  });

  it('生图节点取它当前显示的那张', () => {
    const n = node({
      id: 'g',
      type: 'imagegen',
      imageGenResults: ['media/1.png', 'media/2.png', 'media/3.png'],
      imageGenActiveIndex: 1,
    });
    expect(refSpecOf(n)).toBe('media/2.png');
  });

  it('生图节点没有 activeIndex 时取第一张', () => {
    const n = node({ id: 'g', type: 'imagegen', imageGenResults: ['media/1.png'] });
    expect(refSpecOf(n)).toBe('media/1.png');
  });

  it('activeIndex 越界时退回第一张', () => {
    const n = node({
      id: 'g',
      type: 'imagegen',
      imageGenResults: ['media/1.png'],
      imageGenActiveIndex: 9,
    });
    expect(refSpecOf(n)).toBe('media/1.png');
  });

  it('还没有结果的生图节点提供不了参考图', () => {
    expect(refSpecOf(node({ id: 'g', type: 'imagegen' }))).toBeUndefined();
    expect(refSpecOf(node({ id: 'g', type: 'imagegen', imageGenResults: [] }))).toBeUndefined();
  });
});

describe('collectImageGenInputs', () => {
  const target = node({ id: 'gen', type: 'imagegen' });

  it('邻接图片成为参考图', () => {
    const nodes = [target, node({ id: 'img1', type: 'image', filePath: 'media/a.png' })];
    const got = collectImageGenInputs('gen', nodes, [edge('img1', 'gen')]);
    expect(got.refImages).toEqual([{ nodeId: 'img1', spec: 'media/a.png' }]);
  });

  it('邻接文本拼成提示词，按节点 id 排序保证稳定', () => {
    const nodes = [
      target,
      node({ id: 'b', type: 'text', content: '第二段' }),
      node({ id: 'a', type: 'note', content: '第一段' }),
    ];
    const got = collectImageGenInputs('gen', nodes, [edge('b', 'gen'), edge('a', 'gen')]);
    expect(got.upstreamText).toBe('第一段\n\n第二段');
  });

  it('主题卡、AI 卡、文档都算文本来源', () => {
    const nodes = [
      target,
      node({ id: 'a', type: 'theme', content: '主题' }),
      node({ id: 'b', type: 'ai', content: 'AI 回复' }),
      node({ id: 'c', type: 'document', content: '文档正文' }),
    ];
    const got = collectImageGenInputs('gen', nodes, [
      edge('a', 'gen'),
      edge('b', 'gen'),
      edge('c', 'gen'),
    ]);
    expect(got.upstreamText).toBe('主题\n\nAI 回复\n\n文档正文');
  });

  it('空白文本不参与拼接', () => {
    const nodes = [target, node({ id: 'a', type: 'text', content: '   ' })];
    expect(collectImageGenInputs('gen', nodes, [edge('a', 'gen')]).upstreamText).toBe('');
  });

  it('上游生图节点也能当参考图（决策 5）', () => {
    const nodes = [
      target,
      node({ id: 'up', type: 'imagegen', imageGenResults: ['media/up.png'] }),
    ];
    const got = collectImageGenInputs('gen', nodes, [edge('up', 'gen')]);
    expect(got.refImages).toEqual([{ nodeId: 'up', spec: 'media/up.png' }]);
    expect(got.hasImageGenNeighbor).toBe(true);
  });

  it('互相连着的两个生图节点不会死循环——只取直接邻居', () => {
    const a = node({ id: 'a', type: 'imagegen', imageGenResults: ['media/a.png'] });
    const b = node({ id: 'b', type: 'imagegen', imageGenResults: ['media/b.png'] });
    const edges = [edge('a', 'b'), edge('b', 'a')];

    expect(collectImageGenInputs('a', [a, b], edges).refImages).toEqual([
      { nodeId: 'b', spec: 'media/b.png' },
    ]);
    expect(collectImageGenInputs('b', [a, b], edges).refImages).toEqual([
      { nodeId: 'a', spec: 'media/a.png' },
    ]);
  });

  it('不递归：隔着一跳的图片不算参考图', () => {
    const nodes = [
      target,
      node({ id: 'mid', type: 'text', content: '中间' }),
      node({ id: 'far', type: 'image', filePath: 'media/far.png' }),
    ];
    const got = collectImageGenInputs('gen', nodes, [edge('mid', 'gen'), edge('far', 'mid')]);
    expect(got.refImages).toEqual([]);
  });

  it('参考图超出上限时截断并报数量，而不是静默丢弃', () => {
    const images = Array.from({ length: 6 }, (_, i) =>
      node({ id: `img${i}`, type: 'image', filePath: `media/${i}.png` }),
    );
    const edges = images.map((n) => edge(n.id, 'gen'));
    const got = collectImageGenInputs('gen', [target, ...images], edges, { maxRefImages: 2 });

    expect(got.refImages).toHaveLength(2);
    expect(got.ignoredRefCount).toBe(4);
  });

  it('模型上限比硬上限大时仍按硬上限截', () => {
    const images = Array.from({ length: 8 }, (_, i) =>
      node({ id: `img${i}`, type: 'image', filePath: `media/${i}.png` }),
    );
    const edges = images.map((n) => edge(n.id, 'gen'));
    const got = collectImageGenInputs('gen', [target, ...images], edges, { maxRefImages: 99 });
    expect(got.refImages).toHaveLength(MAX_REF_IMAGES);
  });

  it('被点掉的参考图不参与，也不计入被截断数', () => {
    const nodes = [
      target,
      node({ id: 'a', type: 'image', filePath: 'media/a.png' }),
      node({ id: 'b', type: 'image', filePath: 'media/b.png' }),
    ];
    const edges = [edge('a', 'gen'), edge('b', 'gen')];
    const got = collectImageGenInputs('gen', nodes, edges, { excludedRefIds: ['a'] });

    expect(got.refImages).toEqual([{ nodeId: 'b', spec: 'media/b.png' }]);
    expect(got.ignoredRefCount).toBe(0);
  });

  it('ignoreUpstreamText 时不收文本，但参考图照收', () => {
    const nodes = [
      target,
      node({ id: 'a', type: 'text', content: '别用我' }),
      node({ id: 'b', type: 'image', filePath: 'media/b.png' }),
    ];
    const got = collectImageGenInputs('gen', nodes, [edge('a', 'gen'), edge('b', 'gen')], {
      ignoreUpstreamText: true,
    });
    expect(got.upstreamText).toBe('');
    expect(got.refImages).toHaveLength(1);
  });

  it('没有邻居时一切为空', () => {
    const got = collectImageGenInputs('gen', [target], []);
    expect(got).toEqual({
      refImages: [],
      upstreamText: '',
      ignoredRefCount: 0,
      hasImageGenNeighbor: false,
    });
  });

  it('连线指向已删节点时安全跳过', () => {
    const got = collectImageGenInputs('gen', [target], [edge('ghost', 'gen')]);
    expect(got.refImages).toEqual([]);
  });

  it('maxRefImages 为 0（模型不支持图生图）时不带参考图', () => {
    const nodes = [target, node({ id: 'a', type: 'image', filePath: 'media/a.png' })];
    const got = collectImageGenInputs('gen', nodes, [edge('a', 'gen')], { maxRefImages: 0 });
    expect(got.refImages).toEqual([]);
    expect(got.ignoredRefCount).toBe(1);
  });
});

describe('buildImageGenPrompt', () => {
  it('上游在前，节点提示词在后', () => {
    expect(buildImageGenPrompt('一只猫', '水彩风格')).toBe('一只猫\n水彩风格');
  });

  it('任一为空时不留多余换行', () => {
    expect(buildImageGenPrompt('', '水彩风格')).toBe('水彩风格');
    expect(buildImageGenPrompt('一只猫', '')).toBe('一只猫');
  });

  it('两者皆空返回空串（调用方据此禁用生成）', () => {
    expect(buildImageGenPrompt('', '')).toBe('');
    expect(buildImageGenPrompt('  ', '  ')).toBe('');
  });
});
