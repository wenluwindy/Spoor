import { describe, it, expect } from 'vitest';
import {
  addChatModel,
  addImageModel,
  addProvider,
  changeProviderKind,
  createProviderFromPreset,
  removeChatModel,
  removeImageModel,
  removeProvider,
  setActiveChat,
  setDefaultImage,
  setMetasoApiKey,
  updateChatModel,
  updateImageModel,
  updateProvider,
} from '../../src/services/aiConfigEdit';
import { emptyAiConfigV2, resolveActiveChatConfig, resolveImageModel } from '../../src/services/aiConfig';
import { DOUBAO_ARK_BASE_URL } from '../../src/constants/doubao';
import { OPENAI_BASE_URL } from '../../src/constants/aiProviderPresets';

describe('createProviderFromPreset', () => {
  it('填好 Base URL 与生图协议，Key 留空', () => {
    const p = createProviderFromPreset('doubao');
    expect(p.baseUrl).toBe(DOUBAO_ARK_BASE_URL);
    expect(p.imageApiKind).toBe('doubao_seedream');
    // 预设里绝不能带 Key——那会被从安装包里扒出来
    expect(p.apiKey).toBe('');
  });

  it('带生图预设的服务商预置生图模型', () => {
    expect(createProviderFromPreset('openai').imageModels.length).toBeGreaterThan(0);
    expect(createProviderFromPreset('gemini').imageModels.length).toBeGreaterThan(0);
  });

  it('不支持生图的服务商没有生图模型，也没有协议', () => {
    const p = createProviderFromPreset('deepseek');
    expect(p.imageModels).toEqual([]);
    expect(p.imageApiKind).toBeUndefined();
  });

  it('总是带一条对话模型，用户直接填即可', () => {
    expect(createProviderFromPreset('openai').chatModels).toHaveLength(1);
    // 火山方舟没有通用默认模型（要账号自己的 ep- 接入点），但仍给一条空的
    const doubao = createProviderFromPreset('doubao');
    expect(doubao.chatModels).toHaveLength(1);
    expect(doubao.chatModels[0].modelName).toBe('');
  });

  it('可以自定义显示名', () => {
    expect(createProviderFromPreset('custom', '公司内网').name).toBe('公司内网');
  });

  it('每次生成不同 id', () => {
    expect(createProviderFromPreset('openai').id).not.toBe(createProviderFromPreset('openai').id);
  });
});

describe('addProvider', () => {
  it('第一个服务商顺手设为当前对话服务商', () => {
    const p = createProviderFromPreset('openai');
    const c = addProvider(emptyAiConfigV2(), p);
    expect(c.activeChat).toEqual({ providerId: p.id, modelId: p.chatModels[0].id });
  });

  it('之后添加的不抢当前指向', () => {
    const first = createProviderFromPreset('openai');
    const second = createProviderFromPreset('gemini');
    const c = addProvider(addProvider(emptyAiConfigV2(), first), second);
    expect(c.activeChat.providerId).toBe(first.id);
    expect(c.providers).toHaveLength(2);
  });
});

describe('updateProvider', () => {
  it('改字段但 id 不可变', () => {
    const p = createProviderFromPreset('openai');
    const c = updateProvider(addProvider(emptyAiConfigV2(), p), p.id, {
      apiKey: 'sk-x',
      id: 'hacked',
    } as never);
    expect(c.providers[0].apiKey).toBe('sk-x');
    expect(c.providers[0].id).toBe(p.id);
  });

  it('id 不存在时原样返回', () => {
    const c = addProvider(emptyAiConfigV2(), createProviderFromPreset('openai'));
    expect(updateProvider(c, 'nope', { apiKey: 'x' })).toEqual(c);
  });
});

describe('changeProviderKind', () => {
  it('没改过 Base URL 时跟着换成新类型的默认值', () => {
    const p = createProviderFromPreset('openai');
    const c = changeProviderKind(addProvider(emptyAiConfigV2(), p), p.id, 'doubao');
    expect(c.providers[0].baseUrl).toBe(DOUBAO_ARK_BASE_URL);
    expect(c.providers[0].imageApiKind).toBe('doubao_seedream');
  });

  it('用户改过 Base URL 就不覆盖', () => {
    const p = createProviderFromPreset('openai');
    let c = addProvider(emptyAiConfigV2(), p);
    c = updateProvider(c, p.id, { baseUrl: 'https://gateway.internal/v1' });
    c = changeProviderKind(c, p.id, 'doubao');
    // 自建网关被吃掉的话，用户得重填一次
    expect(c.providers[0].baseUrl).toBe('https://gateway.internal/v1');
  });

  it('空 Base URL 视为没改过', () => {
    const p = createProviderFromPreset('custom');
    const c = changeProviderKind(addProvider(emptyAiConfigV2(), p), p.id, 'openai');
    expect(c.providers[0].baseUrl).toBe(OPENAI_BASE_URL);
  });

  it('显示名没自定义过时跟着 kind 走', () => {
    const p = createProviderFromPreset('openai');
    const c = changeProviderKind(addProvider(emptyAiConfigV2(), p), p.id, 'gemini');
    expect(c.providers[0].name).toBe('gemini');
  });

  it('自定义过的显示名保留', () => {
    const p = createProviderFromPreset('openai', '我的服务');
    const c = changeProviderKind(addProvider(emptyAiConfigV2(), p), p.id, 'gemini');
    expect(c.providers[0].name).toBe('我的服务');
  });
});

describe('removeProvider', () => {
  it('删掉正在用的服务商后 activeChat 不悬空', () => {
    const a = createProviderFromPreset('openai');
    const b = createProviderFromPreset('gemini');
    let c = addProvider(addProvider(emptyAiConfigV2(), a), b);
    c = removeProvider(c, a.id);

    expect(c.providers).toHaveLength(1);
    expect(c.activeChat.providerId).toBe(b.id);
    expect(c.activeChat.modelId).toBe(b.chatModels[0].id);
    // 压回扁平形状后仍能拿到一个可用模型
    expect(resolveActiveChatConfig(c).model).toBe(b.chatModels[0].modelName);
  });

  it('删掉最后一个服务商后 activeChat 归空', () => {
    const a = createProviderFromPreset('openai');
    const c = removeProvider(addProvider(emptyAiConfigV2(), a), a.id);
    expect(c.providers).toEqual([]);
    expect(c.activeChat).toEqual({ providerId: '', modelId: '' });
  });

  it('删掉非当前服务商时不动指向', () => {
    const a = createProviderFromPreset('openai');
    const b = createProviderFromPreset('gemini');
    let c = addProvider(addProvider(emptyAiConfigV2(), a), b);
    c = removeProvider(c, b.id);
    expect(c.activeChat.providerId).toBe(a.id);
  });

  it('顺带清掉指向它的 defaultImage', () => {
    const a = createProviderFromPreset('openai');
    let c = addProvider(emptyAiConfigV2(), a);
    c = setDefaultImage(c, a.id, a.imageModels[0].id);
    c = removeProvider(c, a.id);
    expect(c.defaultImage).toBeUndefined();
  });

  it('不动指向别的服务商的 defaultImage', () => {
    const a = createProviderFromPreset('openai');
    const b = createProviderFromPreset('gemini');
    let c = addProvider(addProvider(emptyAiConfigV2(), a), b);
    c = setDefaultImage(c, b.id, b.imageModels[0].id);
    c = removeProvider(c, a.id);
    expect(c.defaultImage?.providerId).toBe(b.id);
  });
});

describe('对话模型 CRUD', () => {
  const base = () => {
    const p = createProviderFromPreset('openai');
    return { p, c: addProvider(emptyAiConfigV2(), p) };
  };

  it('加一条空模型', () => {
    const { p, c } = base();
    const next = addChatModel(c, p.id);
    expect(next.providers[0].chatModels).toHaveLength(2);
    expect(next.providers[0].chatModels[1].modelName).toBe('');
  });

  it('服务商原本没有模型时，新加的设为当前', () => {
    const { p } = base();
    let c = addProvider(emptyAiConfigV2(), { ...p, chatModels: [] });
    c = addChatModel(c, p.id);
    expect(c.activeChat.modelId).toBe(c.providers[0].chatModels[0].id);
  });

  it('改模型名', () => {
    const { p, c } = base();
    const next = updateChatModel(c, p.id, p.chatModels[0].id, { modelName: 'o3' });
    expect(next.providers[0].chatModels[0].modelName).toBe('o3');
  });

  it('删掉当前模型后落到同服务商的另一条', () => {
    const { p } = base();
    let c = addProvider(emptyAiConfigV2(), p);
    c = addChatModel(c, p.id);
    const secondId = c.providers[0].chatModels[1].id;
    c = removeChatModel(c, p.id, p.chatModels[0].id);

    expect(c.providers[0].chatModels).toHaveLength(1);
    expect(c.activeChat.modelId).toBe(secondId);
  });

  it('删光某服务商的模型后落到另一个服务商', () => {
    const a = createProviderFromPreset('openai');
    const b = createProviderFromPreset('gemini');
    let c = addProvider(addProvider(emptyAiConfigV2(), a), b);
    c = removeChatModel(c, a.id, a.chatModels[0].id);

    expect(c.activeChat.providerId).toBe(b.id);
    expect(c.activeChat.modelId).toBe(b.chatModels[0].id);
  });

  it('删掉非当前模型时不动指向', () => {
    const { p } = base();
    let c = addProvider(emptyAiConfigV2(), p);
    c = addChatModel(c, p.id);
    const secondId = c.providers[0].chatModels[1].id;
    c = removeChatModel(c, p.id, secondId);
    expect(c.activeChat.modelId).toBe(p.chatModels[0].id);
  });
});

describe('生图模型 CRUD', () => {
  it('第一条生图模型顺手设为全局默认', () => {
    const p = createProviderFromPreset('deepseek'); // 无预设生图模型
    let c = addProvider(emptyAiConfigV2(), p);
    expect(c.defaultImage).toBeUndefined();

    c = addImageModel(c, p.id);
    expect(c.defaultImage).toEqual({
      providerId: p.id,
      modelId: c.providers[0].imageModels[0].id,
    });
  });

  it('已有默认时不抢', () => {
    const p = createProviderFromPreset('openai');
    let c = addProvider(emptyAiConfigV2(), p);
    c = setDefaultImage(c, p.id, p.imageModels[0].id);
    c = addImageModel(c, p.id);
    expect(c.defaultImage?.modelId).toBe(p.imageModels[0].id);
  });

  it('不给预设时建一条只支持文生图的空模型', () => {
    const p = createProviderFromPreset('deepseek');
    const c = addImageModel(addProvider(emptyAiConfigV2(), p), p.id);
    expect(c.providers[0].imageModels[0].capabilities).toEqual({
      textToImage: true,
      imageToImage: false,
      maxRefImages: 0,
    });
  });

  it('改生图模型的能力', () => {
    const p = createProviderFromPreset('openai');
    let c = addProvider(emptyAiConfigV2(), p);
    c = updateImageModel(c, p.id, p.imageModels[0].id, {
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 2 },
    });
    expect(c.providers[0].imageModels[0].capabilities.maxRefImages).toBe(2);
  });

  it('删掉默认生图模型后清空 defaultImage', () => {
    const p = createProviderFromPreset('openai');
    let c = addProvider(emptyAiConfigV2(), p);
    c = setDefaultImage(c, p.id, p.imageModels[0].id);
    c = removeImageModel(c, p.id, p.imageModels[0].id);

    expect(c.defaultImage).toBeUndefined();
    expect(resolveImageModel(c)).toBeNull();
  });

  it('删掉非默认的不动 defaultImage', () => {
    const p = createProviderFromPreset('gemini'); // 预设两条
    let c = addProvider(emptyAiConfigV2(), p);
    c = setDefaultImage(c, p.id, p.imageModels[0].id);
    c = removeImageModel(c, p.id, p.imageModels[1].id);
    expect(c.defaultImage?.modelId).toBe(p.imageModels[0].id);
  });
});

describe('setActiveChat / setDefaultImage / setMetasoApiKey', () => {
  it('setActiveChat 直接改指向', () => {
    const c = setActiveChat(emptyAiConfigV2(), 'p', 'm');
    expect(c.activeChat).toEqual({ providerId: 'p', modelId: 'm' });
  });

  it('setMetasoApiKey 去空白，空串存 undefined', () => {
    expect(setMetasoApiKey(emptyAiConfigV2(), '  sk-x  ').metasoApiKey).toBe('sk-x');
    expect(setMetasoApiKey(emptyAiConfigV2(), '   ').metasoApiKey).toBeUndefined();
  });
});

describe('不变式：任何一串编辑之后 activeChat 都指得到东西', () => {
  it('连续增删不留悬空指向', () => {
    const a = createProviderFromPreset('openai');
    const b = createProviderFromPreset('doubao');
    let c = addProvider(addProvider(emptyAiConfigV2(), a), b);

    c = addChatModel(c, b.id);
    c = removeChatModel(c, a.id, a.chatModels[0].id);
    c = removeProvider(c, a.id);

    const flat = resolveActiveChatConfig(c);
    expect(c.providers.some((p) => p.id === c.activeChat.providerId)).toBe(true);
    expect(flat.provider).toBe('doubao');
  });
});
