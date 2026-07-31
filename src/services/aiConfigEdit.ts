import type {
  AIConfigV2,
  AIModelEntry,
  AIProviderProfile,
  ImageModelEntry,
  ProviderKind,
  SearchProviderKind,
} from '../types/aiConfig';
import {
  PRESET_CHAT_MODEL,
  PRESET_IMAGE_MODELS,
  PROVIDER_DEFAULT_BASE_URL,
  defaultImageApiKind,
} from '../constants/aiProviderPresets';

/**
 * 配置的写操作，全是**纯函数**：进一份配置，出一份新配置。
 *
 * 单独放一层是因为这些操作有必须守住的不变式——删掉正在用的服务商之后
 * `activeChat` 不能悬空，删掉最后一个对话模型之后也不能。把它们埋在组件的
 * `setState` 回调里，就没法单独验证，也一定会漏掉某条分支。
 */

function newId(): string {
  return crypto.randomUUID();
}

// ───────────────────────────── 服务商 ─────────────────────────────

/** 按预设建一个服务商：Base URL、生图协议、默认模型都填好，Key 留给用户。 */
export function createProviderFromPreset(kind: ProviderKind, name?: string): AIProviderProfile {
  const chatPreset = PRESET_CHAT_MODEL[kind];
  const imagePresets = PRESET_IMAGE_MODELS[kind] ?? [];

  return {
    id: newId(),
    name: name?.trim() || kind,
    kind,
    apiKey: '',
    baseUrl: PROVIDER_DEFAULT_BASE_URL[kind],
    // 火山方舟没有预设对话模型：它要的是账号下的推理接入点 ID，没有通用默认值。
    // 仍然建一条空的，用户直接往里填就行，不用先点「添加模型」
    chatModels: [
      chatPreset
        ? { id: newId(), modelName: chatPreset.modelName, label: chatPreset.label }
        : { id: newId(), modelName: '', label: '' },
    ],
    imageModels: imagePresets.map((m) => ({ ...m, id: newId() })),
    imageApiKind: defaultImageApiKind(kind),
  };
}

export function addProvider(config: AIConfigV2, provider: AIProviderProfile): AIConfigV2 {
  const providers = [...config.providers, provider];
  // 第一个服务商顺手设为当前对话服务商，省一步手动选择
  const activeChat =
    config.providers.length === 0
      ? { providerId: provider.id, modelId: provider.chatModels[0]?.id ?? '' }
      : config.activeChat;
  return { ...config, providers, activeChat };
}

export function updateProvider(
  config: AIConfigV2,
  providerId: string,
  patch: Partial<AIProviderProfile>,
): AIConfigV2 {
  return {
    ...config,
    providers: config.providers.map((p) => (p.id === providerId ? { ...p, ...patch, id: p.id } : p)),
  };
}

/**
 * 换服务商类型：Base URL 与生图协议跟着换。
 *
 * Base URL 只在用户没改过（还等于旧类型的默认值）时才覆盖——改过说明是自建
 * 网关之类的，覆盖掉等于把用户填的东西吃了。
 */
export function changeProviderKind(
  config: AIConfigV2,
  providerId: string,
  kind: ProviderKind,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;

  const untouchedBaseUrl =
    provider.baseUrl.trim() === '' || provider.baseUrl === PROVIDER_DEFAULT_BASE_URL[provider.kind];

  return updateProvider(config, providerId, {
    kind,
    baseUrl: untouchedBaseUrl ? PROVIDER_DEFAULT_BASE_URL[kind] : provider.baseUrl,
    imageApiKind: defaultImageApiKind(kind),
    name: provider.name === provider.kind ? kind : provider.name,
  });
}

/** 删服务商，并把指向它的 `activeChat` / `defaultImage` 重新落到还活着的条目上。 */
export function removeProvider(config: AIConfigV2, providerId: string): AIConfigV2 {
  const providers = config.providers.filter((p) => p.id !== providerId);

  const activeChat =
    config.activeChat.providerId === providerId
      ? { providerId: providers[0]?.id ?? '', modelId: providers[0]?.chatModels[0]?.id ?? '' }
      : config.activeChat;

  const defaultImage =
    config.defaultImage?.providerId === providerId ? undefined : config.defaultImage;

  return { ...config, providers, activeChat, defaultImage };
}

// ───────────────────────────── 模型 ─────────────────────────────

export function addChatModel(config: AIConfigV2, providerId: string): AIConfigV2 {
  const model: AIModelEntry = { id: newId(), modelName: '', label: '' };
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;

  const next = updateProvider(config, providerId, { chatModels: [...provider.chatModels, model] });
  // 该服务商原本一个模型都没有：新加的这条顺手设为当前
  return provider.chatModels.length === 0
    ? { ...next, activeChat: { providerId, modelId: model.id } }
    : next;
}

export function updateChatModel(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
  patch: Partial<AIModelEntry>,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;
  return updateProvider(config, providerId, {
    chatModels: provider.chatModels.map((m) => (m.id === modelId ? { ...m, ...patch, id: m.id } : m)),
  });
}

/** 删对话模型；删掉的正是当前使用的那个时，`activeChat` 重新落位。 */
export function removeChatModel(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;

  const chatModels = provider.chatModels.filter((m) => m.id !== modelId);
  const next = updateProvider(config, providerId, { chatModels });

  if (config.activeChat.providerId !== providerId || config.activeChat.modelId !== modelId) {
    return next;
  }
  // 优先落到同一服务商的其他模型，没有了再换服务商
  const fallbackProvider = chatModels.length > 0 ? provider : next.providers.find((p) => p.chatModels.length > 0);
  return {
    ...next,
    activeChat: {
      providerId: chatModels.length > 0 ? providerId : fallbackProvider?.id ?? '',
      modelId: chatModels.length > 0 ? chatModels[0].id : fallbackProvider?.chatModels[0]?.id ?? '',
    },
  };
}

/** 加生图模型。给了预设就用预设，否则建一条空的让用户填。 */
export function addImageModel(
  config: AIConfigV2,
  providerId: string,
  preset?: Omit<ImageModelEntry, 'id'>,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;

  const model: ImageModelEntry = preset
    ? { ...preset, id: newId() }
    : {
        id: newId(),
        modelName: '',
        label: '',
        capabilities: { textToImage: true, imageToImage: false, maxRefImages: 0 },
      };

  const next = updateProvider(config, providerId, { imageModels: [...provider.imageModels, model] });
  // 全局还没有默认生图模型时，第一条顺手补上
  return config.defaultImage
    ? next
    : { ...next, defaultImage: { providerId, modelId: model.id } };
}

export function updateImageModel(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
  patch: Partial<ImageModelEntry>,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;
  return updateProvider(config, providerId, {
    imageModels: provider.imageModels.map((m) =>
      m.id === modelId ? { ...m, ...patch, id: m.id } : m,
    ),
  });
}

export function removeImageModel(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
): AIConfigV2 {
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return config;

  const next = updateProvider(config, providerId, {
    imageModels: provider.imageModels.filter((m) => m.id !== modelId),
  });

  const wasDefault =
    config.defaultImage?.providerId === providerId && config.defaultImage?.modelId === modelId;
  return wasDefault ? { ...next, defaultImage: undefined } : next;
}

// ───────────────────────────── 默认指向 ─────────────────────────────

export function setActiveChat(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
): AIConfigV2 {
  return { ...config, activeChat: { providerId, modelId } };
}

export function setDefaultImage(
  config: AIConfigV2,
  providerId: string,
  modelId: string,
): AIConfigV2 {
  return { ...config, defaultImage: { providerId, modelId } };
}

// ───────────────────────────── 搜索服务 ─────────────────────────────

export function setSearchProvider(config: AIConfigV2, kind: SearchProviderKind): AIConfigV2 {
  return { ...config, searchProvider: kind };
}

/**
 * 存某一家的 Key。各家各存各的——切换服务不该把已经填好的 Key 冲掉。
 *
 * 秘塔额外同步一份到老的 `metasoApiKey` 字段：万一用户装回旧版本，Key 还在。
 */
export function setSearchApiKey(
  config: AIConfigV2,
  kind: SearchProviderKind,
  key: string,
): AIConfigV2 {
  const trimmed = key.trim();
  const next = { ...(config.searchApiKeys ?? {}) };
  if (trimmed) {
    next[kind] = trimmed;
  } else {
    delete next[kind];
  }

  return {
    ...config,
    searchApiKeys: Object.keys(next).length > 0 ? next : undefined,
    ...(kind === 'metaso' ? { metasoApiKey: trimmed || undefined } : {}),
  };
}

/** @deprecated 用 [`setSearchApiKey`]。留着是因为老测试与外部调用还在引。 */
export function setMetasoApiKey(config: AIConfigV2, key: string): AIConfigV2 {
  return setSearchApiKey(config, 'metaso', key);
}
