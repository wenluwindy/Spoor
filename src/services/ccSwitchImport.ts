import type { AIConfigV2, AIModelEntry, AIProviderProfile, ProviderKind } from '../types/aiConfig';
import { PRESET_CHAT_MODEL, defaultImageApiKind } from '../constants/aiProviderPresets';

/**
 * 解析 cc-switch（https://github.com/farion1231/cc-switch）的服务商配置。
 *
 * 当前版 cc-switch 把配置放在 `<用户目录>/.cc-switch/cc-switch.db` 的
 * `providers` 表中；桌面命令会把每行转换为 `{ name, settingsConfig }`。
 * 早期版本使用过多种 JSON 外层结构，所以解析器仍保持递归识别以兼容旧数据。
 *
 * 所以这里**不按某个版本的结构逐层取值**，而是把整棵 JSON 走一遍，
 * 认「同时有 name 和 settingsConfig 的对象」为一条服务商，再从
 * `settingsConfig` 里认环境变量。这样新版本换了外层包装也照样能读，
 * 代价只是可能多认出几条无效项——它们没有密钥，会被跳过并计数。
 */

/** 递归深度上限。正常配置最多四五层，够用且防住畸形输入。 */
const MAX_DEPTH = 8;

export interface CcSwitchParseResult {
  providers: AIProviderProfile[];
  /** 认出来了但没法用（没有密钥、或认不出协议）的条数。 */
  skipped: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 走遍整棵树，捞出所有 `{ name, settingsConfig }` 形状的对象。 */
function collectCandidates(
  value: unknown,
  out: Record<string, unknown>[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, out, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  if (str(value.name) && isRecord(value.settingsConfig)) out.push(value);

  for (const child of Object.values(value)) collectCandidates(child, out, depth + 1);
}

/**
 * 从 Codex 的 TOML 片段里挖字段。
 *
 * cc-switch 把 `~/.codex/config.toml` 的内容原样存成一个字符串，这里没必要
 * 引一个 TOML 解析器——只要 `base_url` 和 `model` 两个值，正则够了。
 * `model` 必须锚在行首，否则会被 `model_provider = "…"` 抢走。
 */
function fromTomlText(toml: string): { baseUrl: string; model: string } {
  const baseUrl = /^\s*base_url\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1] ?? '';
  const model = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1] ?? '';
  return { baseUrl: baseUrl.trim(), model: model.trim() };
}

function readEnv(settingsConfig: Record<string, unknown>): Record<string, string> {
  const env = isRecord(settingsConfig.env) ? settingsConfig.env : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const s = str(v);
    if (s) out[k.toUpperCase()] = s;
  }
  return out;
}

/** Anthropic 那几个模型环境变量，去重后按出现顺序保留。 */
const ANTHROPIC_MODEL_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
];

function newId(): string {
  return crypto.randomUUID();
}

function toChatModels(names: string[], kind: ProviderKind): AIModelEntry[] {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length > 0) {
    return unique.map((modelName) => ({ id: newId(), modelName, label: modelName }));
  }
  // cc-switch 里很多条目不写模型名——Claude Code 用服务商的默认模型。
  // 给一条预设让它开箱能用，用户在设置里改一下就行。
  const preset = PRESET_CHAT_MODEL[kind];
  return [preset
    ? { id: newId(), modelName: preset.modelName, label: preset.label }
    : { id: newId(), modelName: '', label: '' }];
}

/** 由 Base URL 猜服务商类型。认不出就归 `custom`，反正都是 OpenAI 兼容协议。 */
function kindFromOpenAiBaseUrl(baseUrl: string): ProviderKind {
  const url = baseUrl.toLowerCase();
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('deepseek')) return 'deepseek';
  return 'custom';
}

function buildProfile(
  name: string,
  kind: ProviderKind,
  apiKey: string,
  baseUrl: string,
  modelNames: string[],
): AIProviderProfile {
  return {
    id: newId(),
    name,
    kind,
    apiKey,
    baseUrl,
    chatModels: toChatModels(modelNames, kind),
    // 生图模型不导：cc-switch 只管对话，猜出来的生图配置一定是错的
    imageModels: [],
    imageApiKind: defaultImageApiKind(kind),
  };
}

function candidateToProfile(candidate: Record<string, unknown>): AIProviderProfile | null {
  const name = str(candidate.name);
  const settingsConfig = candidate.settingsConfig as Record<string, unknown>;
  const env = readEnv(settingsConfig);

  // ── Claude 侧：ANTHROPIC_* 环境变量 ──
  const anthropicKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    // Base URL 原样留着（cc-switch 存的是不含 /v1 的站点根）。
    // `anthropicMessagesUrl` 两种写法都收，这里不猜、不改用户填的地址。
    return buildProfile(
      name,
      'anthropic',
      anthropicKey,
      env.ANTHROPIC_BASE_URL ?? '',
      ANTHROPIC_MODEL_KEYS.map((k) => env[k] ?? ''),
    );
  }

  // ── Codex 侧：auth.OPENAI_API_KEY + config 里的 TOML ──
  const auth = isRecord(settingsConfig.auth) ? settingsConfig.auth : {};
  const openaiKey = str(auth.OPENAI_API_KEY) || env.OPENAI_API_KEY || '';
  if (openaiKey) {
    const rawConfig = settingsConfig.config;
    const toml = typeof rawConfig === 'string'
      ? fromTomlText(rawConfig)
      // 有的版本把 config 存成已解析的对象
      : isRecord(rawConfig)
        ? { baseUrl: str(rawConfig.base_url), model: str(rawConfig.model) }
        : { baseUrl: '', model: '' };
    const baseUrl = toml.baseUrl || env.OPENAI_BASE_URL || '';
    return buildProfile(name, kindFromOpenAiBaseUrl(baseUrl), openaiKey, baseUrl, [toml.model]);
  }

  // 没有密钥就没法用。cc-switch 里「官方登录」那类条目就长这样，
  // 它靠的是 Claude Code 自己的 OAuth，我们拿不到也用不上。
  return null;
}

/** 同一份配置里同类型 + 同地址 + 同密钥的重复项只留一条。 */
function dedupeKey(p: Pick<AIProviderProfile, 'kind' | 'baseUrl' | 'apiKey'>): string {
  // 分隔符写成转义的 NUL：地址结尾和密钥开头拼在一起时不会撞车，
  // 又不会在源码里留裸字节，把整个文件变成 git 眼中的二进制。
  return [p.kind, p.baseUrl.replace(/\/+$/, ''), p.apiKey].join('\u0000');
}

export function parseCcSwitchConfig(raw: unknown): CcSwitchParseResult {
  const candidates: Record<string, unknown>[] = [];
  collectCandidates(raw, candidates);

  const providers: AIProviderProfile[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const candidate of candidates) {
    const profile = candidateToProfile(candidate);
    if (!profile) {
      skipped += 1;
      continue;
    }
    const key = dedupeKey(profile);
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push(profile);
  }

  return { providers, skipped };
}

export interface CcSwitchMergeResult {
  config: AIConfigV2;
  added: number;
  /** 已经存在同样的服务商（同类型 + 同地址 + 同密钥），没有重复添加。 */
  duplicates: number;
}

/**
 * 把解析出来的服务商并进现有配置。
 *
 * **只加不覆盖**：用户已经配好的东西不能因为导入一个文件就没了。
 * 已存在的同类型 + 同地址 + 同密钥条目跳过，避免重复导入越点越多。
 */
export function mergeCcSwitchProviders(
  config: AIConfigV2,
  incoming: AIProviderProfile[],
): CcSwitchMergeResult {
  const existing = new Set(config.providers.map(dedupeKey));
  const fresh = incoming.filter((p) => {
    const key = dedupeKey(p);
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });

  if (fresh.length === 0) {
    return { config, added: 0, duplicates: incoming.length };
  }

  const providers = [...config.providers, ...fresh];
  // 原本一个服务商都没有：把第一条导进来的设为当前对话模型，省一步手动选择
  const activeChat =
    config.providers.length === 0
      ? { providerId: fresh[0].id, modelId: fresh[0].chatModels[0]?.id ?? '' }
      : config.activeChat;

  return {
    config: { ...config, providers, activeChat },
    added: fresh.length,
    duplicates: incoming.length - fresh.length,
  };
}
