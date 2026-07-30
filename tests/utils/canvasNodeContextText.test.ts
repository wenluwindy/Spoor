import { describe, it, expect } from 'vitest';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR, getCanvasNodeContextText } from '../../src/utils/canvasNodeContextText';

describe('getCanvasNodeContextText', () => {
  it('优先使用 data-canvas-node-context-text 内文案，排除 UI 标签', () => {
    const root = document.createElement('div');
    root.innerHTML = `<span class="badge">笔记</span><div ${CANVAS_NODE_CONTEXT_TEXT_ATTR}="">如此生活三十年\n直到大厦崩塌</div>`;
    expect(getCanvasNodeContextText(root)).toBe('如此生活三十年\n直到大厦崩塌');
  });

  it('无标记时回退为整颗根的 innerText', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>ONLY</span>';
    expect(getCanvasNodeContextText(root)).toBe('ONLY');
  });

  it('有标记但为空时回退整根', () => {
    const root = document.createElement('div');
    root.innerHTML = `<span>CHROME</span><div ${CANVAS_NODE_CONTEXT_TEXT_ATTR}="">  </div>`;
    expect(getCanvasNodeContextText(root)).toBe('CHROME');
  });
});
