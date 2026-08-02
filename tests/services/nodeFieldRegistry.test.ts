import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  CANVAS_NODE_FIELD_POLICIES,
  collectSpoorExtension,
  pickSpoorExtension,
} from '../../src/services/nodeFieldRegistry';
import { importJsonCanvas, nodeToJsonCanvas } from '../../src/services/jsonCanvas';

/** 每个字段都填上值的"满配"节点——注册表穷举性的实弹检验。 */
const FULL_NODE: Required<Omit<CanvasNode, 'canvasId'>> & { canvasId: string } = {
  id: 'full',
  canvasId: 'c1',
  type: 'ai',
  content: '回答正文',
  description: '描述',
  themeTag: '页脚',
  agentConfigId: 'agent-1',
  fileType: 'pdf',
  filePath: 'media/doc.pdf',
  fileName: 'doc.pdf',
  x: 10,
  y: 20,
  width: 320,
  height: 200,
  layout: 0,
  createdAt: 111,
  updatedAt: 222,
  tags: ['重要'],
  styleOverrides: { bg: '#fef3c7' },
  userTurn: '追问',
  followUpSent: true,
  threadRootContextNodeId: 'root-1',
  threadAgentConfigId: 'agent-1',
  threadContextImageNodeIds: ['img-1'],
  targetCanvasId: 'other-canvas',
  url: 'https://example.com',
  urlTitle: '标题',
  urlSiteName: 'example.com',
  urlExcerpt: '摘要',
  urlImage: 'https://example.com/cover.png',
  urlFetchedAt: 333,
  urlError: 'timeout',
  pdfPage: 3,
  pdfPageCount: 10,
  imageGenProviderId: 'prov',
  imageGenModelId: 'model',
  imageGenPrompt: '提示词',
  imageGenIgnoreUpstreamText: true,
  imageGenParams: { size: '1024x1024', n: 1 },
  imageGenResults: ['media/generated/a.png'],
  imageGenActiveIndex: 0,
  imageGenExcludedRefIds: ['ref-1'],
  imageGenErrorCode: 'err',
  imageGenErrorDetail: '细节',
  imageGenMeta: {
    prompt: 'p',
    providerName: 'P',
    modelName: 'M',
    refPaths: [],
    createdAt: 444,
  },
};

describe('nodeFieldRegistry', () => {
  it('注册表对 CanvasNode 的键穷举（多写/漏写字段这里会先炸）', () => {
    const registryKeys = Object.keys(CANVAS_NODE_FIELD_POLICIES).sort();
    const nodeKeys = Object.keys(FULL_NODE).sort();
    expect(registryKeys).toEqual(nodeKeys);
  });

  it('collect → pick 往返：spoor 字段一个不丢', () => {
    const ext = collectSpoorExtension(FULL_NODE);
    const picked = pickSpoorExtension(ext);
    for (const [key, policy] of Object.entries(CANVAS_NODE_FIELD_POLICIES)) {
      if (policy.jsonCanvas !== 'spoor') continue;
      expect(picked[key as keyof CanvasNode], `字段 ${key} 在往返中丢了`).toEqual(
        FULL_NODE[key as keyof typeof FULL_NODE],
      );
    }
  });

  it('数字 0 与 true 保留，空串/空数组/false 不占行', () => {
    const ext = collectSpoorExtension({
      id: 'n',
      type: 'text',
      x: 0,
      y: 0,
      layout: 0,
      imageGenActiveIndex: 0,
      followUpSent: false,
      themeTag: '',
      tags: [],
    });
    expect(ext.layout).toBe(0);
    expect(ext.imageGenActiveIndex).toBe(0);
    expect('followUpSent' in ext).toBe(false);
    expect('themeTag' in ext).toBe(false);
    expect('tags' in ext).toBe(false);
  });

  it('JSON Canvas 全字段往返：0.4.x 会丢的字段（追问链/生图参数/PDF 页码）现在都回得来', () => {
    const exported = nodeToJsonCanvas(FULL_NODE);
    const { nodes } = importJsonCanvas({ nodes: [exported], edges: [] }, 'c9', () => 'new-1');
    const round = nodes[0];
    expect(round).toMatchObject({
      type: 'ai',
      userTurn: '追问',
      followUpSent: true,
      threadRootContextNodeId: 'root-1',
      threadContextImageNodeIds: ['img-1'],
      pdfPage: 3,
      imageGenParams: { size: '1024x1024', n: 1 },
      imageGenResults: ['media/generated/a.png'],
      imageGenMeta: FULL_NODE.imageGenMeta,
      updatedAt: 222,
      tags: ['重要'],
    });
  });
});
