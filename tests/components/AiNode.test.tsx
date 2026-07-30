import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AiNode } from '../../src/components/nodes/AiNode';
import { db } from '../../src/db';
import type { CanvasNode } from '../../src/db';

vi.mock('../../src/db', () => ({
  db: {
    nodes: { update: vi.fn() },
  },
}));

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', () => {
  const icons = ['Loader2', 'Send'] as const;
  const out: Record<string, React.FC> = {};
  for (const name of icons) {
    out[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return out;
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

const baseAi = (overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'ai-1',
  canvasId: 'default',
  type: 'ai',
  content: 'AI 回复内容',
  x: 0,
  y: 0,
  ...overrides,
});

describe('AiNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.nodes.update).mockClear();
  });

  it('编辑 AI 回复失焦时持久化 content', () => {
    const setEditing = vi.fn();
    render(
      <AiNode
        node={baseAi({ content: '初始回复' })}
        editingNodeId="ai-1"
        setEditingNodeId={setEditing}
      />
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable).toBeTruthy();
    editable.innerText = '更新后的回复';
    fireEvent.blur(editable);
    expect(db.nodes.update).toHaveBeenCalledWith('ai-1', { content: '更新后的回复' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  it('提供 onSubmitFollowUp 且未 followUpSent 时显示追问输入与发送按钮', () => {
    render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSubmitFollowUp={vi.fn()}
        isFollowUpDisabled={false}
      />
    );

    expect(screen.getByPlaceholderText('nodes.ai_follow_up_placeholder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nodes.ai_follow_up_send' })).toBeInTheDocument();
  });

  it('followUpSent 为 true 时不渲染追问区', () => {
    const { container } = render(
      <AiNode
        node={baseAi({ followUpSent: true })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSubmitFollowUp={vi.fn()}
        isFollowUpDisabled={false}
      />
    );

    expect(container.querySelector('textarea')).toBeNull();
  });

  it('未传入 onSubmitFollowUp 时不显示追问区', () => {
    const { container } = render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />
    );

    expect(container.querySelector('textarea')).toBeNull();
  });

  it('有 userTurn 时展示上半区用户文案与下半区正文', () => {
    render(
      <AiNode
        node={baseAi({ userTurn: '用户这一回合的追问', content: '模型回答' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />
    );

    expect(screen.getByText('用户这一回合的追问')).toBeInTheDocument();
    const md = screen.getByTestId('markdown');
    expect(md).toHaveTextContent('模型回答');
  });

  it('输入追问并点击发送会调用 onSubmitFollowUp', async () => {
    const user = userEvent.setup();
    const onSubmitFollowUp = vi.fn();

    render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSubmitFollowUp={onSubmitFollowUp}
        isFollowUpDisabled={false}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '下一回合问题');
    await user.click(screen.getByRole('button', { name: 'nodes.ai_follow_up_send' }));

    expect(onSubmitFollowUp).toHaveBeenCalledTimes(1);
    expect(onSubmitFollowUp).toHaveBeenCalledWith('下一回合问题');
  });

  it('isFollowUpDisabled 为 true 时发送按钮禁用', () => {
    const onSubmitFollowUp = vi.fn();

    render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSubmitFollowUp={onSubmitFollowUp}
        isFollowUpDisabled={true}
      />
    );

    expect(screen.getByRole('button', { name: 'nodes.ai_follow_up_send' })).toBeDisabled();
  });

  it('isFollowUpLoading 时在按钮位置展示 Loader 图标', () => {
    render(
      <AiNode
        node={baseAi()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onSubmitFollowUp={vi.fn()}
        isFollowUpLoading={true}
        isFollowUpDisabled={false}
      />
    );

    expect(screen.getByTestId('icon-Loader2')).toBeInTheDocument();
  });
});
