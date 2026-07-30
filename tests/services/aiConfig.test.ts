import { describe, it, expect } from 'vitest';
import {
  emptyAiConfigV2,
  isAiConfigEmpty,
  listImageModels,
  migrateV1ToV2,
  normalizeAiConfig,
  resolveActiveChatConfig,
  resolveActiveChatTarget,
  resolveImageApiKind,
  resolveImageModel,
} from '../../src/services/aiConfig';
import type { AIConfigV2, AIProviderProfile, ImageModelEntry } from '../../src/types/aiConfig';
import { DOUBAO_ARK_BASE_URL } from '../../src/constants/doubao';

function imageModel(over: Partial<ImageModelEntry> = {}): ImageModelEntry {
  return {
    id: 'im1',
    modelName: 'seedream',
    label: 'Seedream',
    capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
    ...over,
  };
}

function provider(over: Partial<AIProviderProfile> = {}): AIProviderProfile {
  return {
    id: 'p1',
    name: '火山方舟',
    kind: 'doubao',
    apiKey: 'k1',
    baseUrl: DOUBAO_ARK_BASE_URL,
    chatModels: [{ id: 'c1', modelName: 'ep-123', label: '接入点' }],
    imageModels: [],
    ...over,
  };
}

function config(over: Partial<AIConfigV2> = {}): AIConfigV2 {
  return {
    version: 2,
    providers: [provider()],
    activeChat: { providerId: 'p1', modelId: 'c1' },
    ...over,
  };
}

describe('resolveActiveChatTarget', () => {
  it('按 activeChat 定位', () => {
    const { provider: p, modelName } = resolveActiveChatTarget(config());
    expect(p?.id).toBe('p1');
    expect(modelName).toBe('ep-123');
  });

  it('activeChat 指向已删的服务商时退回第一个，而不是整个功能作废', () => {
    const c = config({ activeChat: { providerId: 'gone', modelId: 'gone' } });
    const { provider: p, modelName } = resolveActiveChatTarget(c);
    expect(p?.id).toBe('p1');
    expect(modelName).toBe('ep-123');
  });

  it('模型被删时退回该服务商的第一个模型', () => {
    const c = config({ activeChat: { providerId: 'p1', modelId: 'gone' } });
    expect(resolveActiveChatTarget(c).modelName).toBe('ep-123');
  });

  it('一个服务商都没有时不抛错', () => {
    expect(resolveActiveChatTarget(emptyAiConfigV2())).toEqual({ modelName: '' });
  });

  it('服务商没有任何模型时模型名为空串', () => {
    const c = config({ providers: [provider({ chatModels: [] })] });
    expect(resolveActiveChatTarget(c).modelName).toBe('');
  });
});

describe('resolveActiveChatConfig（喂给既有对话链路的扁平形状）', () => {
  it('压成 v1 的字段名', () => {
    expect(resolveActiveChatConfig(config({ metasoApiKey: 'mk' }))).toEqual({
      provider: 'doubao',
      apiKey: 'k1',
      baseUrl: DOUBAO_ARK_BASE_URL,
      model: 'ep-123',
      localGgufPath: undefined,
      localEnableThinking: undefined,
      metasoApiKey: 'mk',
    });
  });

  it('带上本地 GGUF 字段', () => {
    const c = config({
      providers: [
        provider({ kind: 'local_llama', localGgufPath: 'D:/m.gguf', localEnableThinking: true }),
      ],
    });
    const flat = resolveActiveChatConfig(c);
    expect(flat.provider).toBe('local_llama');
    expect(flat.localGgufPath).toBe('D:/m.gguf');
    expect(flat.localEnableThinking).toBe(true);
  });

  it('空配置给出空 apiKey 的空壳，「未配置」判断不用改', () => {
    const flat = resolveActiveChatConfig(emptyAiConfigV2());
    expect(flat.apiKey).toBe('');
    expect(flat.model).toBe('');
  });

  it('metasoApiKey 是全局的，不属于任何服务商', () => {
    expect(resolveActiveChatConfig(emptyAiConfigV2()).metasoApiKey).toBeUndefined();
    expect(
      resolveActiveChatConfig({ ...emptyAiConfigV2(), metasoApiKey: 'mk' }).metasoApiKey,
    ).toBe('mk');
  });
});

describe('resolveImageApiKind', () => {
  it('按 kind 推导', () => {
    expect(resolveImageApiKind(provider({ kind: 'doubao' }))).toBe('doubao_seedream');
    expect(resolveImageApiKind(provider({ kind: 'openai' }))).toBe('openai_images');
    expect(resolveImageApiKind(provider({ kind: 'gemini' }))).toBe('gemini_image');
    expect(resolveImageApiKind(provider({ kind: 'custom' }))).toBe('custom_openai_images');
  });

  it('没有生图能力的服务商返回 undefined', () => {
    expect(resolveImageApiKind(provider({ kind: 'deepseek' }))).toBeUndefined();
    expect(resolveImageApiKind(provider({ kind: 'anthropic' }))).toBeUndefined();
    expect(resolveImageApiKind(provider({ kind: 'local_llama' }))).toBeUndefined();
  });

  it('显式指定优先于推导', () => {
    expect(
      resolveImageApiKind(provider({ kind: 'custom', imageApiKind: 'gemini_image' })),
    ).toBe('gemini_image');
  });
});

describe('resolveImageModel', () => {
  const withImages = config({
    providers: [provider({ imageModels: [imageModel()] })],
  });

  it('显式 ref 优先', () => {
    const got = resolveImageModel(withImages, { providerId: 'p1', modelId: 'im1' });
    expect(got?.model.modelName).toBe('seedream');
    expect(got?.apiKind).toBe('doubao_seedream');
  });

  it('没传 ref 时用 defaultImage', () => {
    const c = {
      ...config({
        providers: [
          provider({ id: 'p1', imageModels: [imageModel({ id: 'a', modelName: 'first' })] }),
          provider({
            id: 'p2',
            kind: 'openai',
            imageModels: [imageModel({ id: 'b', modelName: 'second' })],
          }),
        ],
      }),
      defaultImage: { providerId: 'p2', modelId: 'b' },
    };
    expect(resolveImageModel(c)?.model.modelName).toBe('second');
  });

  it('都没有时退回第一个有生图模型的服务商', () => {
    expect(resolveImageModel(withImages)?.model.modelName).toBe('seedream');
  });

  it('ref 指向已删的模型时退回默认，而不是返回 null', () => {
    const got = resolveImageModel(withImages, { providerId: 'p1', modelId: 'gone' });
    expect(got?.model.modelName).toBe('seedream');
  });

  it('没有任何生图模型时返回 null（调用方据此禁用生成）', () => {
    expect(resolveImageModel(config())).toBeNull();
    expect(resolveImageModel(emptyAiConfigV2())).toBeNull();
  });

  it('挂了生图模型但服务商不支持生图协议的，不算数', () => {
    const c = config({
      providers: [provider({ kind: 'deepseek', imageModels: [imageModel()] })],
    });
    expect(resolveImageModel(c)).toBeNull();
  });
});

describe('listImageModels', () => {
  it('跨服务商扁平列出', () => {
    const c = config({
      providers: [
        provider({ id: 'p1', imageModels: [imageModel({ id: 'a' }), imageModel({ id: 'b' })] }),
        provider({ id: 'p2', kind: 'gemini', imageModels: [imageModel({ id: 'c' })] }),
        provider({ id: 'p3', kind: 'deepseek', imageModels: [imageModel({ id: 'd' })] }),
      ],
    });
    const list = listImageModels(c);
    expect(list.map((x) => x.model.id)).toEqual(['a', 'b', 'c']);
    expect(list.map((x) => x.apiKind)).toEqual([
      'doubao_seedream',
      'doubao_seedream',
      'gemini_image',
    ]);
  });

  it('没有生图模型时是空数组', () => {
    expect(listImageModels(config())).toEqual([]);
  });
});

describe('migrateV1ToV2', () => {
  it('把扁平配置包成一个服务商', () => {
    const v2 = migrateV1ToV2({
      provider: 'openai',
      apiKey: 'sk-x',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });

    expect(v2.version).toBe(2);
    expect(v2.providers).toHaveLength(1);
    expect(v2.providers[0]).toMatchObject({
      kind: 'openai',
      apiKey: 'sk-x',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(v2.providers[0].chatModels[0].modelName).toBe('gpt-4o');
    // 迁移完必须还指得到
    expect(v2.activeChat.providerId).toBe(v2.providers[0].id);
    expect(v2.activeChat.modelId).toBe(v2.providers[0].chatModels[0].id);
  });

  it('迁移后压回扁平形状与原来等价', () => {
    const v1 = { provider: 'deepseek', apiKey: 'k', baseUrl: 'https://x/v1', model: 'deepseek-chat' };
    const flat = resolveActiveChatConfig(migrateV1ToV2(v1));
    expect(flat).toMatchObject(v1);
  });

  it('缺 baseUrl 时补该服务商的默认值', () => {
    const v2 = migrateV1ToV2({ provider: 'doubao', apiKey: 'k', model: 'ep-1' });
    expect(v2.providers[0].baseUrl).toBe(DOUBAO_ARK_BASE_URL);
  });

  it('模型名为空（豆包没填接入点）仍建一条，让用户去补', () => {
    const v2 = migrateV1ToV2({ provider: 'doubao', apiKey: 'k', model: '' });
    expect(v2.providers[0].chatModels).toHaveLength(1);
    expect(v2.providers[0].chatModels[0].modelName).toBe('');
  });

  it('从没配过（Key 与本地路径都空）时不留空壳服务商', () => {
    const v2 = migrateV1ToV2({ provider: 'doubao', apiKey: '', model: '' });
    expect(v2.providers).toEqual([]);
    expect(isAiConfigEmpty(v2)).toBe(true);
  });

  it('本地 GGUF 只有路径没有 Key 也算配过', () => {
    const v2 = migrateV1ToV2({ provider: 'local_llama', apiKey: '', localGgufPath: 'D:/m.gguf' });
    expect(v2.providers).toHaveLength(1);
    expect(isAiConfigEmpty(v2)).toBe(false);
  });

  it('metasoApiKey 带过来', () => {
    expect(migrateV1ToV2({ apiKey: 'k', metasoApiKey: 'mk' }).metasoApiKey).toBe('mk');
    expect(migrateV1ToV2({ apiKey: 'k', metasoApiKey: '  ' }).metasoApiKey).toBeUndefined();
  });

  it('未知 provider 落回 doubao', () => {
    expect(migrateV1ToV2({ provider: 'wat', apiKey: 'k' }).providers[0].kind).toBe('doubao');
  });
});

describe('normalizeAiConfig', () => {
  it('null / 非对象 → 空配置', () => {
    expect(normalizeAiConfig(null)).toEqual(emptyAiConfigV2());
    expect(normalizeAiConfig('x')).toEqual(emptyAiConfigV2());
    expect(normalizeAiConfig(undefined)).toEqual(emptyAiConfigV2());
  });

  it('没有 version 的按 v1 迁移', () => {
    const got = normalizeAiConfig({ provider: 'openai', apiKey: 'k', model: 'gpt-4o' });
    expect(got.version).toBe(2);
    expect(got.providers).toHaveLength(1);
  });

  it('v2 原样保留', () => {
    const c = config({ metasoApiKey: 'mk' });
    const got = normalizeAiConfig(JSON.parse(JSON.stringify(c)));
    expect(got).toEqual(c);
  });

  it('providers 里的坏条目被丢掉而不是整份配置作废', () => {
    const got = normalizeAiConfig({
      version: 2,
      providers: [null, 'x', { id: 'ok', kind: 'openai', apiKey: 'k' }],
      activeChat: { providerId: 'ok', modelId: '' },
    });
    expect(got.providers).toHaveLength(1);
    expect(got.providers[0].id).toBe('ok');
  });

  it('缺字段的服务商被补齐成合法结构', () => {
    const got = normalizeAiConfig({ version: 2, providers: [{ id: 'p' }] });
    expect(got.providers[0]).toMatchObject({ kind: 'custom', apiKey: '', chatModels: [], imageModels: [] });
  });

  it('生图模型的 capabilities 缺省时补全', () => {
    const got = normalizeAiConfig({
      version: 2,
      providers: [{ id: 'p', kind: 'openai', imageModels: [{ id: 'm', modelName: 'gpt-image-1' }] }],
    });
    expect(got.providers[0].imageModels[0].capabilities).toEqual({
      textToImage: true,
      imageToImage: false,
      maxRefImages: 0,
    });
  });

  it('模型 label 为空时退回 modelName', () => {
    const got = normalizeAiConfig({
      version: 2,
      providers: [{ id: 'p', kind: 'openai', chatModels: [{ id: 'm', modelName: 'gpt-4o', label: '  ' }] }],
    });
    expect(got.providers[0].chatModels[0].label).toBe('gpt-4o');
  });

  it('负的 maxRefImages 夹到 0', () => {
    const got = normalizeAiConfig({
      version: 2,
      providers: [
        { id: 'p', kind: 'openai', imageModels: [{ id: 'm', capabilities: { maxRefImages: -3 } }] },
      ],
    });
    expect(got.providers[0].imageModels[0].capabilities.maxRefImages).toBe(0);
  });
});

describe('isAiConfigEmpty', () => {
  it('有 Key 就算配好了', () => {
    expect(isAiConfigEmpty(config())).toBe(false);
  });

  it('没有服务商算空', () => {
    expect(isAiConfigEmpty(emptyAiConfigV2())).toBe(true);
  });

  it('Key 为空白算空', () => {
    expect(isAiConfigEmpty(config({ providers: [provider({ apiKey: '   ' })] }))).toBe(true);
  });

  it('本地 GGUF 看路径而不是 Key', () => {
    const withPath = config({
      providers: [provider({ kind: 'local_llama', apiKey: '', localGgufPath: 'D:/m.gguf' })],
    });
    expect(isAiConfigEmpty(withPath)).toBe(false);

    const noPath = config({ providers: [provider({ kind: 'local_llama', apiKey: '' })] });
    expect(isAiConfigEmpty(noPath)).toBe(true);
  });
});
