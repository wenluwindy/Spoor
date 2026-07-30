import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MutableRefObject } from 'react';
import { blurActiveContentEditable, commitCanvasInlineEditing } from '../../src/utils/commitCanvasInlineEditing';

function makeRef(map: Record<string, HTMLElement | null> = {}): MutableRefObject<Record<string, HTMLElement | null>> {
  return { current: map } as MutableRefObject<Record<string, HTMLElement | null>>;
}

describe('commitCanvasInlineEditing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('无 editingNodeId 但焦点在 contentEditable 上时仍 blur（主题卡等）', () => {
    const ce = document.createElement('div');
    ce.contentEditable = 'true';
    Object.defineProperty(ce, 'isContentEditable', { get: () => true });
    const blurSpy = vi.spyOn(ce, 'blur');
    document.body.appendChild(ce);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(ce);

    commitCanvasInlineEditing({
      editingNodeId: null,
      nodesRef: makeRef(),
      nodeType: undefined,
    });

    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  it('blurActiveContentEditable 在刷新前触发当前焦点失焦', () => {
    const ce = document.createElement('div');
    Object.defineProperty(ce, 'isContentEditable', { get: () => true });
    const blurSpy = vi.spyOn(ce, 'blur');
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(ce);

    blurActiveContentEditable();

    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  it('无 editingNodeId 且焦点不在 contentEditable 时不误 blur', () => {
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    const blurSpy = vi.spyOn(ce, 'blur');
    document.body.appendChild(ce);

    commitCanvasInlineEditing({
      editingNodeId: null,
      nodesRef: makeRef(),
      nodeType: undefined,
    });

    expect(blurSpy).not.toHaveBeenCalled();
  });

  it('note/text 编辑中优先 blur 节点内 contentEditable，不误触其他卡片的焦点', () => {
    const noteRoot = document.createElement('div');
    const noteCe = document.createElement('div');
    noteCe.setAttribute('contenteditable', 'true');
    noteRoot.appendChild(noteCe);

    const themeCe = document.createElement('div');
    Object.defineProperty(themeCe, 'isContentEditable', { get: () => true });
    document.body.appendChild(themeCe);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(themeCe);

    const noteBlurSpy = vi.spyOn(noteCe, 'blur');
    const themeBlurSpy = vi.spyOn(themeCe, 'blur');

    commitCanvasInlineEditing({
      editingNodeId: 'n1',
      nodesRef: makeRef({ n1: noteRoot }),
      nodeType: 'note',
    });

    expect(noteBlurSpy).toHaveBeenCalledTimes(1);
    expect(themeBlurSpy).not.toHaveBeenCalled();
  });

  it('note/text 类型：在 nodesRef 根下找到 contentEditable 并触发其 blur（让 React onBlur 走单点写库）', () => {
    const root = document.createElement('div');
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    root.appendChild(ce);
    document.body.appendChild(root);

    const ceBlurSpy = vi.spyOn(ce, 'blur');

    commitCanvasInlineEditing({
      editingNodeId: 'n1',
      nodesRef: makeRef({ n1: root }),
      nodeType: 'text',
    });

    expect(ceBlurSpy).toHaveBeenCalledTimes(1);
  });

  it('note/text 类型：找不到 contentEditable 时不抛异常，也不会误触发其他节点的 blur', () => {
    const otherCe = document.createElement('div');
    otherCe.setAttribute('contenteditable', 'true');
    document.body.appendChild(otherCe);
    const otherBlurSpy = vi.spyOn(otherCe, 'blur');

    const emptyRoot = document.createElement('div');

    expect(() =>
      commitCanvasInlineEditing({
        editingNodeId: 'n1',
        nodesRef: makeRef({ n1: emptyRoot }),
        nodeType: 'note',
      })
    ).not.toThrow();

    /** JSDOM 中 contentEditable 不被视为可聚焦，document.activeElement 仍是 body，
     *  所以兜底分支不会去 blur otherCe，这里只断言「不抛 + 不误触发」 */
    expect(otherBlurSpy).not.toHaveBeenCalled();
  });

  it('非便签类型且 activeElement 不是 contentEditable 时，安全无操作（不抛、不误 blur）', () => {
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    document.body.appendChild(ce);
    const blurSpy = vi.spyOn(ce, 'blur');

    expect(() =>
      commitCanvasInlineEditing({
        editingNodeId: 'ai1',
        nodesRef: makeRef(),
        nodeType: 'ai',
      })
    ).not.toThrow();

    /** JSDOM 默认 activeElement 是 body，不会被错误地 blur ce */
    expect(blurSpy).not.toHaveBeenCalled();
  });
});
