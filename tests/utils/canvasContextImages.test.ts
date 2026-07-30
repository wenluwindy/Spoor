import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  collectAgentContextImagePayload,
  MAX_AGENT_CONTEXT_IMAGES,
  resolveImageDataUrlsFromNodeIds,
} from '../../src/utils/canvasContextImages';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function node(id: string, type: string, content?: string): CanvasNode {
  return { id, type, content, x: 0, y: 0, canvasId: 'c1' };
}

function edge(from: string, to: string): Edge {
  return { id: `${from}-${to}`, from, to, canvasId: 'c1' };
}

describe('canvasContextImages', () => {
  describe('collectAgentContextImagePayload', () => {
    it('便签与图分别只连 Agent 时仍能收集到图（星型）', () => {
      const nodes: CanvasNode[] = [
        node('note1', 'note', 'hello'),
        node('agent1', 'agent'),
        node('img1', 'image', tinyPng),
      ];
      const edges: Edge[] = [
        edge('img1', 'agent1'),
        edge('note1', 'agent1'),
      ];
      const { nodeIds, dataUrls } = collectAgentContextImagePayload(
        'note1',
        'agent1',
        nodes,
        edges,
      );
      expect(nodeIds).toEqual(['img1']);
      expect(dataUrls).toEqual([tinyPng]);
    });

    it('便签与图片直连时收集到图', () => {
      const nodes: CanvasNode[] = [
        node('note1', 'note', 't'),
        node('img1', 'image', tinyPng),
      ];
      const edges: Edge[] = [edge('note1', 'img1')];
      const { nodeIds } = collectAgentContextImagePayload('note1', 'agent1', nodes, edges);
      expect(nodeIds).toEqual(['img1']);
    });

    it('按节点 id 排序且去重，最多 MAX_AGENT_CONTEXT_IMAGES 张', () => {
      const urls = [tinyPng, tinyPng.replace('iVBOR', 'iVBPR'), tinyPng.replace('iVBOR', 'iVBSR')];
      const nodes: CanvasNode[] = [
        node('note1', 'note'),
        node('agent1', 'agent'),
        ...urls.map((u, i) => node(`img-z-${i}`, 'image', u)),
        ...urls.map((u, i) => node(`img-a-${i}`, 'image', u)),
      ];
      const edges: Edge[] = [
        edge('note1', 'agent1'),
        ...nodes.filter((n) => n.type === 'image').map((n) => edge('agent1', n.id)),
      ];
      const { nodeIds } = collectAgentContextImagePayload('note1', 'agent1', nodes, edges);
      const sortedImageIds = nodes
        .filter((n) => n.type === 'image')
        .map((n) => n.id)
        .sort();
      expect(nodeIds.length).toBe(MAX_AGENT_CONTEXT_IMAGES);
      expect(nodeIds).toEqual(sortedImageIds.slice(0, MAX_AGENT_CONTEXT_IMAGES));
    });

    it('非 data:image 或缺 content 的 image 节点会被忽略', () => {
      const nodes: CanvasNode[] = [
        node('note1', 'note'),
        node('agent1', 'agent'),
        node('bad', 'image', 'not-a-data-url'),
        node('empty', 'image'),
      ];
      const edges: Edge[] = [
        edge('note1', 'agent1'),
        edge('agent1', 'bad'),
        edge('agent1', 'empty'),
      ];
      const { nodeIds } = collectAgentContextImagePayload('note1', 'agent1', nodes, edges);
      expect(nodeIds).toEqual([]);
    });
  });

  describe('resolveImageDataUrlsFromNodeIds', () => {
    it('按传入顺序解析仍存在且合法的图片节点', () => {
      const nodes: CanvasNode[] = [
        node('i2', 'image', tinyPng),
        node('i1', 'image', tinyPng.replace('iVBOR', 'iVBPR')),
      ];
      const urls = resolveImageDataUrlsFromNodeIds(['i1', 'i2'], nodes);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain('iVBPR');
      expect(urls[1]).toBe(tinyPng);
    });

    it('缺失节点时跳过', () => {
      const nodes: CanvasNode[] = [node('i1', 'image', tinyPng)];
      expect(resolveImageDataUrlsFromNodeIds(['gone', 'i1'], nodes)).toEqual([tinyPng]);
    });
  });
});
