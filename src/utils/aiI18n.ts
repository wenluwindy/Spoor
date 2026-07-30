import i18n from '../i18n';
import type { AgentConfig } from '../db';
import { LEGACY_AGENT_PROMPTS, SYSTEM_AGENT_IDS, type SystemAgentId } from '../constants/defaultAgents';
import { formatAgentMarkdownKnowledgeBlock } from './agentMarkdownKnowledge';

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Global system line so model matches app language (e.g. 简体中文 when UI is zh). */
export function getLocaleDirective(): string {
  return i18n.t('ai.prompts.localeDirective');
}

export function combineSystemParts(...parts: (string | undefined | null)[]): string {
  return parts.map(p => p?.trim()).filter(Boolean).join('\n\n');
}

function isBuiltinAgentId(id: string): id is SystemAgentId {
  return (SYSTEM_AGENT_IDS as readonly string[]).includes(id);
}

/** 与 resolveAgentSystemPrompt 相同策略：内置人格在 en/zh 默认文案之间切换显示，用户自定义则保留。 */
function resolveAgentLocalizedField(agent: AgentConfig, field: 'name' | 'role'): string {
  const id = agent.id;
  if (!isBuiltinAgentId(id)) {
    return String(agent[field] ?? '');
  }
  const current = norm(String(agent[field] ?? ''));
  const candidates = new Set<string>();
  for (const lng of ['en', 'zh'] as const) {
    candidates.add(norm(i18n.getFixedT(lng)(`agents.defaults.${id}.${field}`)));
  }
  if (candidates.has(current)) {
    return i18n.t(`agents.defaults.${id}.${field}`);
  }
  return String(agent[field] ?? '');
}

export function resolveAgentLocalizedName(agent: AgentConfig): string {
  return resolveAgentLocalizedField(agent, 'name');
}

export function resolveAgentLocalizedRole(agent: AgentConfig): string {
  return resolveAgentLocalizedField(agent, 'role');
}

/**
 * If the saved prompt is still a stock / legacy built-in, use the string for the **current** UI language.
 * Custom user edits are left as-is (locale directive still applies separately).
 */
export function resolveAgentSystemPrompt(agent: AgentConfig): string {
  const id = agent.id;
  if (!isBuiltinAgentId(id)) return agent.prompt ?? '';

  const current = norm(agent.prompt ?? '');
  const candidates = new Set<string>();
  for (const lng of ['en', 'zh'] as const) {
    candidates.add(norm(i18n.getFixedT(lng)(`agents.defaults.${id}.prompt`)));
  }
  for (const leg of LEGACY_AGENT_PROMPTS[id as SystemAgentId] ?? []) {
    candidates.add(norm(leg));
  }
  if (candidates.has(current)) {
    return i18n.t(`agents.defaults.${id}.prompt`);
  }
  return agent.prompt ?? '';
}

/**
 * 人设场景的完整 system：语言指令 + 解析后的系统提示词（可选 fallback）+ Markdown 知识块。
 */
export function buildAgentSystemInstruction(agent: AgentConfig, options?: { fallbackPrompt?: string }): string {
  const resolved = resolveAgentSystemPrompt(agent).trim();
  const promptPart = resolved || options?.fallbackPrompt?.trim() || undefined;
  return combineSystemParts(
    getLocaleDirective(),
    promptPart,
    formatAgentMarkdownKnowledgeBlock(agent),
  );
}
