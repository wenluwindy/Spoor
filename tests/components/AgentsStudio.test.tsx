import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AgentsStudio } from '../../src/components/AgentsStudio';
import { db } from '../../src/db';
import type { AgentConfig } from '../../src/db';

const callAIMock = vi.fn();

vi.mock('../../src/utils/agentMarkdownKnowledge', () => ({
  AGENT_KNOWLEDGE_MAX_FILE_BYTES: 512_000,
  isAgentMarkdownFilename: (name: string) => name.endsWith('.md'),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'agents.sandbox_title') return `Sandbox: ${opts?.name ?? ''}`;
        if (key === 'agents.message_placeholder') return `Message ${opts?.name ?? ''}`;
        if (key === 'agents.sandbox_empty') return `Empty sandbox for ${opts?.name ?? ''}`;
        return key;
      },
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../src/utils/aiI18n', () => ({
  buildAgentSystemInstruction: () => 'system',
  getLocaleDirective: () => 'locale',
  resolveAgentLocalizedName: (a: AgentConfig) => a.name,
  resolveAgentLocalizedRole: (a: AgentConfig) => a.role,
  resolveAgentSystemPrompt: (a: AgentConfig) => a.prompt,
}));

vi.mock('lucide-react', () => {
  const names = [
    'Plus', 'Search', 'Bot', 'Wand2', 'Send', 'MessageSquare', 'X', 'FileText',
    'Loader2', 'Trash2', 'RotateCcw',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = () => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}` });
    };
  }
  return icons;
});

const agentA: AgentConfig = {
  id: 'agent-a',
  name: 'Agent Alpha',
  role: 'Tester',
  prompt: 'You are alpha',
  temperature: 0.7,
  creativity: 0.4,
};

const agentB: AgentConfig = {
  id: 'agent-b',
  name: 'Agent Beta',
  role: 'Tester',
  prompt: 'You are beta',
  temperature: 0.5,
  creativity: 0.3,
};

const aiConfig = { provider: 'gemini', apiKey: 'k', baseUrl: '', model: 'gemini-2.0-flash' };

function renderStudio(
  agents: AgentConfig[] = [agentA, agentB],
  setAgentConfigs = vi.fn().mockResolvedValue(undefined),
) {
  return render(
    <AgentsStudio
      agentConfigs={agents}
      setAgentConfigs={setAgentConfigs}
      aiConfig={aiConfig}
      callAI={callAIMock}
    />,
  );
}

describe('AgentsStudio 沙盒', () => {
  beforeEach(async () => {
    await db.agentSandboxThreads.clear();
    callAIMock.mockReset();
    callAIMock.mockResolvedValue('Assistant reply');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('打开沙盒时从 IndexedDB 恢复历史消息', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [
        { role: 'user', text: 'Stored question' },
        { role: 'model', text: 'Stored answer' },
      ],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    await waitFor(() => {
      expect(screen.getByText('Stored question')).toBeInTheDocument();
      expect(screen.getByText('Stored answer')).toBeInTheDocument();
    });
  });

  it('发送消息时通过 onStreamChunk 流式更新沙盒回复', async () => {
    callAIMock.mockImplementation(async (opts: { onStreamChunk?: (t: string) => void }) => {
      opts.onStreamChunk?.('Part');
      opts.onStreamChunk?.('Assistant reply');
      return 'Assistant reply';
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Stream test');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
      expect(callAIMock.mock.calls[0][0].onStreamChunk).toEqual(expect.any(Function));
      expect(screen.getByText('Assistant reply')).toBeInTheDocument();
    });
  });

  it('发送消息后写入 agentSandboxThreads', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Hello sandbox');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
    });
    await waitFor(async () => {
      const row = await db.agentSandboxThreads.get('agent-a');
      expect(row?.messages.some((m) => m.text === 'Hello sandbox')).toBe(true);
      expect(row?.messages.some((m) => m.text === 'Assistant reply')).toBe(true);
    });
  });

  it('清空沙盒删除线程并清空界面', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [{ role: 'user', text: 'To clear' }],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('To clear')).toBeInTheDocument());

    const clearBtn = screen.getByLabelText('agents.sandbox_clear_aria');
    await user.click(clearBtn);
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(() => {
      expect(screen.queryByText('To clear')).not.toBeInTheDocument();
    });
    const row = await db.agentSandboxThreads.get('agent-a');
    expect(row).toBeUndefined();
  });

  it('切换人格后加载对应沙盒记录', async () => {
    await db.agentSandboxThreads.bulkPut([
      {
        agentId: 'agent-a',
        messages: [{ role: 'user', text: 'Only A' }],
        updatedAt: 1,
      },
      {
        agentId: 'agent-b',
        messages: [{ role: 'user', text: 'Only B' }],
        updatedAt: 2,
      },
    ]);

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('Only A')).toBeInTheDocument());

    const betaRow = screen.getByRole('heading', { name: 'Agent Beta' }).closest('[class*="cursor-pointer"]');
    expect(betaRow).toBeTruthy();
    await user.click(betaRow!);
    await waitFor(
      () => {
        expect(screen.getByText('Only B')).toBeInTheDocument();
        expect(screen.queryByText('Only A')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
