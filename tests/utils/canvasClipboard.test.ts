import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  CANVAS_CLIPBOARD_KIND,
  CANVAS_PASTE_OFFSET,
  buildCanvasClipboardPayload,
  materializeCanvasClipboard,
  parseCanvasClipboardPayload,
} from '../../src/utils/canvasClipboard';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  content: id,
  x: 0,
  y: 0,
  ...extra,
});

const edge = (id: string, from: string, to: string): Edge => ({ id, canvasId: 'c1', from, to });

describe('canvasClipboard', () => {
  describe('复制', () => {
    it('整行照抄，只摘掉 id 与画布归属', () => {
      const payload = buildCanvasClipboardPayload(
        [node('n1', { type: 'image', filePath: 'media/a.png', fileName: 'a.png', width: 320 })],
        [],
      )!;

      expect(payload.kind).toBe(CANVAS_CLIPBOARD_KIND);
      expect(payload.nodes[0].sourceId).toBe('n1');
      expect(payload.nodes[0].node).toMatchObject({
        type: 'image',
        filePath: 'media/a.png',
        fileName: 'a.png',
        width: 320,
      });
      expect(payload.nodes[0].node).not.toHaveProperty('id');
      expect(payload.nodes[0].node).not.toHaveProperty('canvasId');
    });

    it('只带两端都在选区内的连线', () => {
      const payload = buildCanvasClipboardPayload(
        [node('n1'), node('n2')],
        [edge('e1', 'n1', 'n2'), edge('e2', 'n1', '选区外')],
      )!;

      expect(payload.edges).toEqual([{ from: 'n1', to: 'n2' }]);
    });

    it('没有节点时返回 null', () => {
      expect(buildCanvasClipboardPayload([], [])).toBeNull();
    });
  });

  describe('解析', () => {
    it('往返一致', () => {
      const payload = buildCanvasClipboardPayload(
        [node('n1'), node('n2', { x: 40, y: 60 })],
        [edge('e1', 'n1', 'n2')],
      )!;
      expect(parseCanvasClipboardPayload(JSON.stringify(payload))).toEqual(payload);
    });

    it('认得 v0.2 的便签负载，升级后第一次粘贴不该失败', () => {
      const v1 = JSON.stringify({
        kind: 'scribe-sticky-v1',
        nodes: [{ type: 'text', content: '旧便签', x: 10, y: 20, layout: 2 }],
      });
      const parsed = parseCanvasClipboardPayload(v1)!;
      expect(parsed.kind).toBe(CANVAS_CLIPBOARD_KIND);
      expect(parsed.nodes[0].node).toMatchObject({ type: 'text', content: '旧便签', layout: 2 });
      expect(parsed.edges).toEqual([]);
    });

    it('不是 JSON、不是画布负载、字段坏掉时一律返回 null', () => {
      expect(parseCanvasClipboardPayload('随手复制的一段文字')).toBeNull();
      expect(parseCanvasClipboardPayload('{"kind":"别的应用"}')).toBeNull();
      expect(
        parseCanvasClipboardPayload(
          JSON.stringify({ kind: CANVAS_CLIPBOARD_KIND, nodes: [{ sourceId: 'a' }] }),
        ),
      ).toBeNull();
      expect(
        parseCanvasClipboardPayload(
          JSON.stringify({
            kind: CANVAS_CLIPBOARD_KIND,
            nodes: [{ sourceId: 'a', node: { type: 'text', x: '不是数字', y: 0 } }],
          }),
        ),
      ).toBeNull();
    });

    it('丢掉指向负载之外的连线', () => {
      const parsed = parseCanvasClipboardPayload(
        JSON.stringify({
          kind: CANVAS_CLIPBOARD_KIND,
          nodes: [{ sourceId: 'a', node: { type: 'text', x: 0, y: 0 } }],
          edges: [{ from: 'a', to: '不在负载里' }],
        }),
      )!;
      expect(parsed.edges).toEqual([]);
    });
  });

  describe('落库', () => {
    const payload = buildCanvasClipboardPayload(
      [node('n1', { x: 100, y: 200 }), node('n2', { x: 140, y: 260 })],
      [edge('e1', 'n1', 'n2')],
    )!;

    it('给了落点就把整批的左上角放过去，相对位置不变', () => {
      const { nodes } = materializeCanvasClipboard(payload, 'c2', { x: 0, y: 0 });
      expect(nodes.map((n) => [n.x, n.y])).toEqual([
        [0, 0],
        [40, 60],
      ]);
      expect(nodes.every((n) => n.canvasId === 'c2')).toBe(true);
    });

    it('没给落点就原地偏移一点', () => {
      const { nodes } = materializeCanvasClipboard(payload, 'c1');
      expect(nodes.map((n) => [n.x, n.y])).toEqual([
        [100 + CANVAS_PASTE_OFFSET, 200 + CANVAS_PASTE_OFFSET],
        [140 + CANVAS_PASTE_OFFSET, 260 + CANVAS_PASTE_OFFSET],
      ]);
    });

    it('连线重新指向新建的副本，而不是原来的节点', () => {
      const { nodes, edges: pasted } = materializeCanvasClipboard(payload, 'c1');
      expect(pasted).toHaveLength(1);
      expect(pasted[0].from).toBe(nodes[0].id);
      expect(pasted[0].to).toBe(nodes[1].id);
      expect(pasted[0].from).not.toBe('n1');
    });

    it('每次落库都换一批新 id', () => {
      const first = materializeCanvasClipboard(payload, 'c1');
      const second = materializeCanvasClipboard(payload, 'c1');
      expect(first.nodes[0].id).not.toBe(second.nodes[0].id);
    });
  });
});
