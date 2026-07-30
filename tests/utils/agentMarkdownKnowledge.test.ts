import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../../src/i18n';
import type { AgentConfig } from '../../src/db';
import {
  AGENT_KNOWLEDGE_MAX_PER_FILE_CHARS,
  AGENT_KNOWLEDGE_MAX_TOTAL_CHARS,
  formatAgentMarkdownKnowledgeBlock,
  isAgentMarkdownFilename,
} from '../../src/utils/agentMarkdownKnowledge';

function baseAgent(overrides: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'x',
    name: 'n',
    role: 'r',
    prompt: 'p',
    ...overrides,
  };
}

describe('agentMarkdownKnowledge', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('isAgentMarkdownFilename accepts .md and .markdown', () => {
    expect(isAgentMarkdownFilename('notes.md')).toBe(true);
    expect(isAgentMarkdownFilename('README.markdown')).toBe(true);
    expect(isAgentMarkdownFilename('x.txt')).toBe(false);
  });

  it('formatAgentMarkdownKnowledgeBlock returns undefined when empty', () => {
    expect(formatAgentMarkdownKnowledgeBlock(baseAgent({}))).toBeUndefined();
    expect(formatAgentMarkdownKnowledgeBlock(baseAgent({ knowledgeMarkdownFiles: [] }))).toBeUndefined();
  });

  it('formatAgentMarkdownKnowledgeBlock joins files with headers', () => {
    const agent = baseAgent({
      knowledgeMarkdownFiles: [
        { name: 'a.md', content: 'Hello' },
        { name: 'b.md', content: 'World' },
      ],
    });
    const block = formatAgentMarkdownKnowledgeBlock(agent);
    expect(block).toContain('Markdown knowledge base');
    expect(block).toContain('### a.md');
    expect(block).toContain('Hello');
    expect(block).toContain('### b.md');
    expect(block).toContain('World');
  });

  it('truncates per-file content and notes', async () => {
    await i18n.changeLanguage('zh');
    const long = 'x'.repeat(AGENT_KNOWLEDGE_MAX_PER_FILE_CHARS + 500);
    const agent = baseAgent({
      knowledgeMarkdownFiles: [{ name: 'big.md', content: long }],
    });
    const block = formatAgentMarkdownKnowledgeBlock(agent)!;
    expect(block.length).toBeLessThanOrEqual(long.length + 500);
    expect(block).toContain('单文件');
  });

  it('truncates total block length', () => {
    const chunk = 'y'.repeat(Math.floor(AGENT_KNOWLEDGE_MAX_TOTAL_CHARS / 2) + 1000);
    const agent = baseAgent({
      knowledgeMarkdownFiles: [
        { name: 'one.md', content: chunk },
        { name: 'two.md', content: chunk },
      ],
    });
    const block = formatAgentMarkdownKnowledgeBlock(agent)!;
    expect(block.length).toBeLessThanOrEqual(AGENT_KNOWLEDGE_MAX_TOTAL_CHARS + 400);
    expect(block).toContain('total context limit');
  });
});
