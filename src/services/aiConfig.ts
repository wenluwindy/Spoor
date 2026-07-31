import type { AIConfig } from '../components/AISettingsModal';
import type {
  AIConfigV2,
  AIProviderProfile,
  ImageApiKind,
  ImageModelEntry,
  ModelRef,
  ProviderKind,
  SearchProviderKind,
} from '../types/aiConfig';
import {
  PROVIDER_DEFAULT_BASE_URL,
  defaultImageApiKind,
} from '../constants/aiProviderPresets';
import { DEFAULT_SEARCH_PROVIDER, isSearchProviderKind } from '../constants/searchProviders';

/**
 * v2 配置的读取与迁移。
 *
 * 核心是 [`resolveActiveChatConfig`]：把 v2 压回 v1 的扁平形状。对话链路
 * （`services/ai`、`ResearchLab`、`AgentsStudio`、`useAiActions`）一行都不用改，
 * 重构的爆炸半径就只剩这一个文件。
 */

const PROVIDER_KINDS: ProviderKind[] = [
  'doubao',
  'openai',
  'gemini',
  'anthropic',
  'deepseek',
  'mimo',
  'custom',
  'local_llama',
];

function isProviderKind(v: unknown): v is ProviderKind {
  return typeof v === 'string' && (PROVIDER_KINDS as string[]).includes(v);
}

/** 新建 id。测试里要可预期，所以允许注入。 */
function newId(): string {
  return crypto.randomUUID();
}

// ───────────────────────────── 读取 ─────────────────────────────

export function findProvider(
  config: AIConfigV2,
  providerId: string | undefined,
): AIProviderProfile | undefined {
  if (!providerId) return undefined;
  return config.providers.find((p) => p.id === providerId);
}

/**
 * 解析出当前对话该用的服务商与模型。
 *
 * `activeChat` 可能指向已被删掉的服务商/模型（用户在设置里删了），此时**退回第一个**
 * 而不是报错——让用户面对一个功能全废的应用，不如安静地用一个还能用的。
 */
export function resolveActiveChatTarget(config: AIConfigV2): {
  provider?: AIProviderProfile;
  modelName: string;
} {
  const provider = findProvider(config, config.activeChat?.providerId) ?? config.providers[0];
  if (!provider) return { modelName: '' };

  const model =
    provider.chatModels.find((m) => m.id === config.activeChat?.modelId) ?? provider.chatModels[0];
  return { provider, modelName: model?.modelName ?? '' };
}

/**
 * 把 v2 压成 v1 的扁平形状，喂给既有的对话链路。
 *
 * 没有任何服务商时返回一份空壳（`apiKey: ''`），这样「未配置」的判断
 * 与首启引导卡的逻辑都不用改。
 */
export function resolveActiveChatConfig(config: AIConfigV2): AIConfig {
  const { provider, modelName } = resolveActiveChatTarget(config);
  return {
    provider: provider?.kind ?? 'doubao',
    apiKey: provider?.apiKey ?? '',
    baseUrl: provider?.baseUrl ?? '',
    model: modelName,
    localGgufPath: provider?.localGgufPath,
    localEnableThinking: provider?.localEnableThinking,
    ...resolveSearchConfig(config),
  };
}

export interface ResolvedSearchConfig {
  searchProvider: SearchProviderKind;
  searchApiKey: string;
}

/**
 * 当前启用的搜索服务与它的 Key。
 *
 * `metasoApiKey` 是老字段，`normalizeAiConfig` 已经把它迁进 `searchApiKeys.metaso`；
 * 这里再兜一次，是为了让没走过 normalize 的调用方（测试里直接构造的配置）也对。
 */
export function resolveSearchConfig(config: AIConfigV2): ResolvedSearchConfig {
  const kind = config.searchProvider ?? DEFAULT_SEARCH_PROVIDER;
  const stored = config.searchApiKeys?.[kind] ?? '';
  const key = kind === 'metaso' ? stored || (config.metasoApiKey ?? '') : stored;
  return { searchProvider: kind, searchApiKey: key.trim() };
}

export interface ResolvedImageModel {
  provider: AIProviderProfile;
  model: ImageModelEntry;
  /** 实际使用的生图协议：服务商显式指定优先，否则按 kind 推导。 */
  apiKind: ImageApiKind;
}

/** 服务商实际使用的生图协议；该服务商不支持生图时返回 `undefined`。 */
export function resolveImageApiKind(provider: AIProviderProfile): ImageApiKind | undefined {
  return provider.imageApiKind ?? defaultImageApiKind(provider.kind);
}

/**
 * 定位一个生图模型。不传 ref 时用 `defaultImage`，再退回第一个可用的。
 * 找不到任何生图模型时返回 `null`——调用方据此禁用生成按钮。
 */
export function resolveImageModel(
  config: AIConfigV2,
  ref?: Partial<ModelRef>,
): ResolvedImageModel | null {
  // 指名道姓的先试：节点自己选的 → 全局默认。指到已删的条目就往下走
  const named = [ref, config.defaultImage].filter(
    (r): r is Partial<ModelRef> => !!r?.providerId,
  );

  for (const candidate of named) {
    const provider = findProvider(config, candidate.providerId);
    if (!provider) continue;
    const apiKind = resolveImageApiKind(provider);
    if (!apiKind) continue;

    const model = candidate.modelId
      ? provider.imageModels.find((m) => m.id === candidate.modelId)
      : provider.imageModels[0];
    if (!model) continue;

    return { provider, model, apiKind };
  }

  // 都指不到就用第一个能生图的
  return listImageModels(config)[0] ?? null;
}

/** 所有可用生图模型的扁平列表，供节点上的模型下拉按服务商分组展示。 */
export function listImageModels(config: AIConfigV2): ResolvedImageModel[] {
  const out: ResolvedImageModel[] = [];
  for (const provider of config.providers) {
    const apiKind = resolveImageApiKind(provider);
    if (!apiKind) continue;
    for (const model of provider.imageModels) {
      out.push({ provider, model, apiKind });
    }
  }
  return out;
}

// ───────────────────────────── 迁移与规范化 ─────────────────────────────

export function emptyAiConfigV2(): AIConfigV2 {
  return { version: 2, providers: [], activeChat: { providerId: '', modelId: '' } };
}

/**
 * v1 扁平配置 → v2。
 *
 * 计划原本写的是「直接丢弃重建」（当时判断没有存量用户）。实际开发机上就存着
 * 一份配好的 v1，丢弃等于让人重填 Key；包成一个服务商只要几行，就顺手做了。
 * Key 为空的 v1 视为「从没配过」，直接返回空配置，免得留一个空壳服务商。
 */
export function migrateV1ToV2(v1: Partial<AIConfig>): AIConfigV2 {
  const kind = isProviderKind(v1.provider) ? v1.provider : 'doubao';
  const apiKey = (v1.apiKey ?? '').trim();
  const localPath = (v1.localGgufPath ?? '').trim();
  const metasoApiKey = (v1.metasoApiKey ?? '').trim() || undefined;

  const searchApiKeys = metasoApiKey ? { metaso: metasoApiKey } : undefined;

  const everConfigured = apiKey !== '' || localPath !== '';
  if (!everConfigured) {
    return { ...emptyAiConfigV2(), metasoApiKey, searchApiKeys };
  }

  const providerId = newId();
  const modelName = (v1.model ?? '').trim();
  const modelId = newId();

  const provider: AIProviderProfile = {
    id: providerId,
    name: kind,
    kind,
    apiKey,
    baseUrl: (v1.baseUrl ?? '').trim() || PROVIDER_DEFAULT_BASE_URL[kind],
    // 模型名可能是空的（豆包没填接入点 ID），仍然建一条，让用户在设置里补
    chatModels: [{ id: modelId, modelName, label: modelName }],
    imageModels: [],
    localGgufPath: v1.localGgufPath,
    localEnableThinking: v1.localEnableThinking,
  };

  return {
    version: 2,
    providers: [provider],
    activeChat: { providerId, modelId },
    metasoApiKey,
    searchApiKeys,
  };
}

function normalizeModelEntry(raw: unknown): { id: string; modelName: string; label: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const modelName = typeof o.modelName === 'string' ? o.modelName : '';
  const label = typeof o.label === 'string' && o.label.trim() ? o.label : modelName;
  return { id: typeof o.id === 'string' && o.id ? o.id : newId(), modelName, label };
}

function normalizeImageModel(raw: unknown): ImageModelEntry | null {
  const base = normalizeModelEntry(raw);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  const caps = (o.capabilities ?? {}) as Record<string, unknown>;
  return {
    ...base,
    capabilities: {
      textToImage: caps.textToImage !== false,
      imageToImage: caps.imageToImage === true,
      maxRefImages: typeof caps.maxRefImages === 'number' ? Math.max(0, caps.maxRefImages) : 0,
    },
    sizeOptions: Array.isArray(o.sizeOptions) ? o.sizeOptions.map(String) : undefined,
    defaultParams: (o.defaultParams as ImageModelEntry['defaultParams']) ?? undefined,
  };
}

function normalizeProvider(raw: unknown): AIProviderProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = isProviderKind(o.kind) ? o.kind : 'custom';
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newId(),
    name: typeof o.name === 'string' && o.name.trim() ? o.name : kind,
    kind,
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : PROVIDER_DEFAULT_BASE_URL[kind],
    chatModels: Array.isArray(o.chatModels)
      ? o.chatModels.map(normalizeModelEntry).filter((m): m is NonNullable<typeof m> => m !== null)
      : [],
    imageModels: Array.isArray(o.imageModels)
      ? o.imageModels.map(normalizeImageModel).filter((m): m is ImageModelEntry => m !== null)
      : [],
    imageApiKind: (o.imageApiKind as ImageApiKind | undefined) ?? undefined,
    localGgufPath: typeof o.localGgufPath === 'string' ? o.localGgufPath : undefined,
    localEnableThinking: o.localEnableThinking === true ? true : undefined,
  };
}

/**
 * 任意来源（localStorage 的字符串、v1 对象、v2 对象）→ 一份可用的 v2。
 *
 * 坏数据一律降级为空配置而不是抛错：配置读不出来就把整个应用卡死，
 * 远不如让用户重新填一次。
 */
export function normalizeAiConfig(raw: unknown): AIConfigV2 {
  if (!raw || typeof raw !== 'object') return emptyAiConfigV2();
  const o = raw as Record<string, unknown>;

  if (o.version !== 2) return migrateV1ToV2(o as Partial<AIConfig>);

  const providers = Array.isArray(o.providers)
    ? o.providers.map(normalizeProvider).filter((p): p is AIProviderProfile => p !== null)
    : [];
  const activeChat = (o.activeChat ?? {}) as Partial<ModelRef>;

  return {
    version: 2,
    providers,
    activeChat: {
      providerId: typeof activeChat.providerId === 'string' ? activeChat.providerId : '',
      modelId: typeof activeChat.modelId === 'string' ? activeChat.modelId : '',
    },
    defaultImage: (o.defaultImage as ModelRef | undefined) ?? undefined,
    ...normalizeSearchSettings(o),
  };
}

/**
 * 搜索服务设置的规范化。
 *
 * 老配置只有 `metasoApiKey`，把它抬进 `searchApiKeys.metaso`——不迁的话，
 * 用户升级后打开「搜索服务」页会看到一个空输入框，以为 Key 丢了。
 * 老字段本身留着不删，回退到旧版本时仍然能读。
 */
function normalizeSearchSettings(o: Record<string, unknown>): Partial<AIConfigV2> {
  const legacy = typeof o.metasoApiKey === 'string' ? o.metasoApiKey.trim() : '';
  const raw = (o.searchApiKeys ?? {}) as Record<string, unknown>;

  const keys: Partial<Record<SearchProviderKind, string>> = {};
  for (const [kind, value] of Object.entries(raw)) {
    if (isSearchProviderKind(kind) && typeof value === 'string' && value.trim()) {
      keys[kind] = value.trim();
    }
  }
  if (!keys.metaso && legacy) keys.metaso = legacy;

  return {
    metasoApiKey: legacy || undefined,
    searchProvider: isSearchProviderKind(o.searchProvider) ? o.searchProvider : undefined,
    searchApiKeys: Object.keys(keys).length > 0 ? keys : undefined,
  };
}

/** 是否还没配任何模型服务（首启引导卡据此显示）。 */
export function isAiConfigEmpty(config: AIConfigV2): boolean {
  const { provider } = resolveActiveChatTarget(config);
  if (!provider) return true;
  if (provider.kind === 'local_llama') return !(provider.localGgufPath ?? '').trim();
  return !provider.apiKey.trim();
}
