import { describe, it, expect } from 'vitest';
import {
  buildStickyClipboardPayload,
  parseStickyClipboardPayload,
  stickyPastePosition,
  STICKY_CLIPBOARD_KIND,
  isTextEditingTarget,
} from '../../src/utils/noteClipboard';
import type { CanvasNode } from '../../src/db';

describe('noteClipboard', () => {
  it('buildStickyClipboardPayload keeps only note and text', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'ai', content: 'x', x: 0, y: 0 },
      { id: 'b', type: 'note', content: 'hello', x: 10, y: 20, layout: 1, width: 300 },
    ];
    const p = buildStickyClipboardPayload(nodes);
    expect(p?.kind).toBe(STICKY_CLIPBOARD_KIND);
    expect(p?.nodes).toHaveLength(1);
    expect(p?.nodes[0]).toMatchObject({ type: 'note', content: 'hello', x: 10, y: 20, layout: 1, width: 300 });
  });

  it('parseStickyClipboardPayload rejects bad kind or type', () => {
    expect(parseStickyClipboardPayload('')).toBeNull();
    expect(parseStickyClipboardPayload('{"kind":"other"}')).toBeNull();
    expect(
      parseStickyClipboardPayload(
        JSON.stringify({
          kind: STICKY_CLIPBOARD_KIND,
          nodes: [{ type: 'ai', x: 0, y: 0 }],
        }),
      ),
    ).toBeNull();
  });

  it('round-trip', () => {
    const nodes: CanvasNode[] = [{ id: 'n1', type: 'text', content: 'ab', x: 5, y: 6, layout: 2 }];
    const json = JSON.stringify(buildStickyClipboardPayload(nodes)!);
    const back = parseStickyClipboardPayload(json)!;
    expect(back.nodes[0]).toMatchObject({ type: 'text', content: 'ab', x: 5, y: 6, layout: 2 });
    expect(stickyPastePosition(back.nodes[0])).toEqual({ x: 29, y: 30 });
  });

  it('isTextEditingTarget detects contenteditable', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isTextEditingTarget(el)).toBe(true);
    expect(isTextEditingTarget(document.createElement('button'))).toBe(false);
  });
});
