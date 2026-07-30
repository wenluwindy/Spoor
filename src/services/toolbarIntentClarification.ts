import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { intentOptionsAreInvalidClarification } from '../utils/intentOptionSanitize';

export type ToolbarIntentAnalysis =
  | { ambiguous: false }
  | { ambiguous: true; options: [string, string, string]; hint?: string };

function extractFirstJsonObject(raw: string): unknown {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(t);
  const body = fence ? fence[1].trim() : t;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error('intent_json');
  }
}

function normalizeAnalysis(parsed: unknown): ToolbarIntentAnalysis {
  if (!parsed || typeof parsed !== 'object') return { ambiguous: false };
  const o = parsed as Record<string, unknown>;
  const ambiguous = o.ambiguous === true;
  const optionsRaw = o.options;
  if (!ambiguous || !Array.isArray(optionsRaw)) return { ambiguous: false };
  const opts = optionsRaw.map((x) => String(x).trim()).filter(Boolean);
  if (opts.length !== 3) return { ambiguous: false };
  const hint = typeof o.hint === 'string' && o.hint.trim() ? o.hint.trim() : undefined;
  const options: [string, string, string] = [opts[0], opts[1], opts[2]];
  if (intentOptionsAreInvalidClarification(options)) return { ambiguous: false };
  return { ambiguous: true, options, hint };
}

/**
 * 调用轻量模型调用，判断是否需用户从三种理解中选一种；无疑义则 ambiguous: false。
 */
export async function analyzeToolbarIntentPreflight(
  userText: string,
  config: AIConfig,
  t: TFunction<'translation', undefined>,
): Promise<ToolbarIntentAnalysis> {
  const systemInstruction = t('ai.intent.analyzer_system');
  const prompt = t('ai.intent.analyzer_user', { text: userText });
  const raw = await callUniversalAI({
    config,
    systemInstruction: combineSystemParts(getLocaleDirective(), systemInstruction),
    prompt,
    temperature: 0.15,
    topP: 0.35,
  });
  if (!raw?.trim()) return { ambiguous: false };
  try {
    const parsed = extractFirstJsonObject(raw);
    return normalizeAnalysis(parsed);
  } catch {
    return { ambiguous: false };
  }
}
