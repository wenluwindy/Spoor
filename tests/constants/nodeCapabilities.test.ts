import { describe, it, expect } from 'vitest';
import { nodeSupportsCycleLayout, NODE_TYPES_WITH_LAYOUT_CYCLE } from '../../src/constants/nodeCapabilities';

describe('nodeSupportsCycleLayout', () => {
  it('仅 theme/note/text 为 true（与 ThemeNode / NoteNode 读取 layout 一致）', () => {
    expect(NODE_TYPES_WITH_LAYOUT_CYCLE).toEqual(['theme', 'note', 'text']);

    expect(nodeSupportsCycleLayout('theme')).toBe(true);
    expect(nodeSupportsCycleLayout('note')).toBe(true);
    expect(nodeSupportsCycleLayout('text')).toBe(true);

    expect(nodeSupportsCycleLayout('ai')).toBe(false);
    expect(nodeSupportsCycleLayout('agent')).toBe(false);
    expect(nodeSupportsCycleLayout('image')).toBe(false);
    expect(nodeSupportsCycleLayout('video')).toBe(false);
    expect(nodeSupportsCycleLayout('document')).toBe(false);
    expect(nodeSupportsCycleLayout('unknown')).toBe(false);
  });
});
