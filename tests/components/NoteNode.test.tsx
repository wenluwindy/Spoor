import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NoteNode } from '../../src/components/nodes/NoteNode';
import { updateNodeRecorded } from '../../src/services/canvasMutations';
import type { CanvasNode } from '../../src/db';
import type { AppThemeId } from '../../src/constants/appThemes';
import { APP_THEME_STORAGE_KEY, resetAppThemeStoreForTests } from '../../src/services/appTheme';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/services/canvasMutations', () => ({
  canvasIdOf: (row: { canvasId?: string }) => row.canvasId || 'default',
  updateNodeRecorded: vi.fn(),
}));

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => false,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

const makeNode = (overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'note',
  content: 'Test content',
  x: 0,
  y: 0,
  ...overrides,
});

describe('NoteNode', () => {
  /** 外壳形态来自全局主题，测试通过切主题而非改 node.layout 来选形态。 */
  const useTheme = (id: AppThemeId) => {
    localStorage.setItem(APP_THEME_STORAGE_KEY, id);
    resetAppThemeStoreForTests();
  };

  beforeEach(() => {
    vi.mocked(updateNodeRecorded).mockClear();
    useTheme('paper');
  });

  it.each(['paper', 'midnight', 'minimal', 'neo'] as const)('%s 主题下渲染 Markdown 正文', (theme) => {
    useTheme(theme);
    render(<NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
  });

  it('midnight 主题走毛玻璃外壳', () => {
    useTheme('midnight');
    const { container } = render(
      <NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(screen.getByText('nodes.thought_node')).toBeInTheDocument();
    expect(container.querySelector('.note-surface-glass')).toBeTruthy();
    expect(container.querySelector('.note-glass-wash')).toBeTruthy();
  });

  it('neo 主题显示观察标签键', () => {
    useTheme('neo');
    render(<NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.getByText('nodes.observation')).toBeInTheDocument();
  });

  it('调色板 CSS 变量存在时 midnight 仍保留毛玻璃表面类名', () => {
    useTheme('midnight');
    const { container } = render(
      <div
        style={
          {
            '--node-bg': '#1a1a1a',
            '--node-text': '#ffffff',
            '--node-border': '#333333',
          } as React.CSSProperties
        }
      >
        <NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />
      </div>,
    );
    expect(container.querySelector('.note-surface-glass')).toBeTruthy();
    expect(container.querySelector('.note-glass-wash')).toBeTruthy();
  });

  it('node.layout 不再被读取：库里残留的旧值不影响外壳', () => {
    useTheme('paper');
    const { container } = render(
      <NoteNode
        node={makeNode({ layout: 1 })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    // paper 绑定 layout 0（经典壳），残留的 layout: 1（毛玻璃）必须不生效
    expect(container.querySelector('.note-surface-glass')).toBeFalsy();
    expect(container.querySelector('.note-surface-standard')).toBeTruthy();
  });

  it('连续切换主题时 Markdown 正文仍可见（NoteBody 稳定）', () => {
    const setEditing = vi.fn();
    const { rerender } = render(
      <NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={setEditing} />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
    for (const theme of ['midnight', 'minimal', 'neo'] as const) {
      useTheme(theme);
      rerender(<NoteNode node={makeNode()} editingNodeId={null} setEditingNodeId={setEditing} />);
      expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
    }
  });

  it('editingNodeId 匹配时出现 contentEditable 且内容为 node.content', () => {
    render(<NoteNode node={makeNode()} editingNodeId="n1" setEditingNodeId={vi.fn()} />);
    const el = document.querySelector('[contenteditable="true"]');
    expect(el).toBeTruthy();
    expect(el).toHaveTextContent('Test content');
  });

  it('失焦且允许持久化时记一步可撤销的写库并退出编辑', () => {
    const setEditing = vi.fn();
    render(<NoteNode node={makeNode()} editingNodeId="n1" setEditingNodeId={setEditing} />);
    const el = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(el).toBeTruthy();
    el.innerText = 'Updated body';
    fireEvent.blur(el);
    expect(updateNodeRecorded).toHaveBeenCalledWith('c1', 'n1', { content: 'Updated body' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });
});
