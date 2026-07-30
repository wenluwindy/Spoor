import type { AgentConfig } from '../db';
import i18n from '../i18n';

/** 单次请求中知识块总长上限（字符）。 */
export const AGENT_KNOWLEDGE_MAX_TOTAL_CHARS = 120_000;

/** 单文件注入正文上限（字符）；超出则截断并附说明。 */
export const AGENT_KNOWLEDGE_MAX_PER_FILE_CHARS = 200_000;

/** 文件选择器拒绝读取的体积上限（字节），避免一次性读入过大文件。 */
export const AGENT_KNOWLEDGE_MAX_FILE_BYTES = 800_000;

const KNOWLEDGE_HEADER = '## Markdown knowledge base (full text, not RAG)';

/**
 * 将人设关联的 Markdown 正文格式化为 system 的一段；无文件时返回 undefined。
 * 按单文件与总长上限截断，并在块内附带 i18n 截断说明。
 */
export function formatAgentMarkdownKnowledgeBlock(agent: AgentConfig): string | undefined {
  const raw = agent.knowledgeMarkdownFiles?.filter((f) => (f.name ?? '').trim() && (f.content ?? '').length > 0);
  if (!raw?.length) return undefined;

  const parts: string[] = [KNOWLEDGE_HEADER];

  for (const file of raw) {
    let body = file.content;
    let truncated = false;
    if (body.length > AGENT_KNOWLEDGE_MAX_PER_FILE_CHARS) {
      body = body.slice(0, AGENT_KNOWLEDGE_MAX_PER_FILE_CHARS);
      truncated = true;
    }
    const note = truncated ? `\n${i18n.t('agents.knowledge_file_truncated_note')}` : '';
    parts.push(`### ${file.name}${note}\n\n${body}`);
  }

  let out = parts.join('\n\n');
  if (out.length > AGENT_KNOWLEDGE_MAX_TOTAL_CHARS) {
    out =
      out.slice(0, AGENT_KNOWLEDGE_MAX_TOTAL_CHARS).trimEnd() +
      `\n\n${i18n.t('agents.knowledge_total_truncated_note')}`;
  }

  return out;
}

export function isAgentMarkdownFilename(filename: string): boolean {
  return /\.(md|markdown)$/i.test(filename.trim());
}
