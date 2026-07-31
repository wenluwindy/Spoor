import { describe, it, expect } from 'vitest';
import {
  mergeCcSwitchProviders,
  parseCcSwitchConfig,
} from '../../src/services/ccSwitchImport';
import type { AIConfigV2 } from '../../src/types/aiConfig';

/** cc-switch v3 的形状：apps → providers（以 id 为键的字典）→ settingsConfig。 */
const V3_CONFIG = {
  version: 3,
  apps: {
    claude: {
      providers: {
        'id-official': {
          id: 'id-official',
          name: '官方登录',
          settingsConfig: { env: {} },
        },
        'id-relay': {
          id: 'id-relay',
          name: '某中转站',
          settingsConfig: {
            env: {
              ANTHROPIC_AUTH_TOKEN: 'sk-relay-key',
              ANTHROPIC_BASE_URL: 'https://relay.example.com',
              ANTHROPIC_MODEL: 'claude-sonnet-4-5',
            },
          },
        },
      },
      current: 'id-relay',
    },
    codex: {
      providers: {
        'id-codex': {
          id: 'id-codex',
          name: 'Codex 中转',
          settingsConfig: {
            auth: { OPENAI_API_KEY: 'sk-codex-key' },
            config:
              'model_provider = "myrelay"\nmodel = "gpt-5-codex"\n\n' +
              '[model_providers.myrelay]\nname = "myrelay"\n' +
              'base_url = "https://codex.example.com/v1"\nwire_api = "responses"\n',
          },
        },
      },
      current: 'id-codex',
    },
  },
};

describe('parseCcSwitchConfig', () => {
  it('从 v3 结构里读出 Claude 与 Codex 两条服务商', () => {
    const { providers } = parseCcSwitchConfig(V3_CONFIG);
    expect(providers.map((p) => p.name)).toEqual(['某中转站', 'Codex 中转']);
  });

  it('Claude 条目映射成 anthropic 类型，Base URL 原样保留', () => {
    const { providers } = parseCcSwitchConfig(V3_CONFIG);
    const claude = providers.find((p) => p.kind === 'anthropic');
    expect(claude).toMatchObject({
      kind: 'anthropic',
      apiKey: 'sk-relay-key',
      baseUrl: 'https://relay.example.com',
    });
    expect(claude?.chatModels.map((m) => m.modelName)).toEqual(['claude-sonnet-4-5']);
  });

  it('Codex 条目从 TOML 里挖出 base_url 与 model', () => {
    const { providers } = parseCcSwitchConfig(V3_CONFIG);
    const codex = providers.find((p) => p.apiKey === 'sk-codex-key');
    expect(codex).toMatchObject({
      kind: 'custom',
      baseUrl: 'https://codex.example.com/v1',
    });
    // model_provider = "myrelay" 不能被当成 model
    expect(codex?.chatModels.map((m) => m.modelName)).toEqual(['gpt-5-codex']);
  });

  it('没有密钥的条目跳过并计数', () => {
    const { providers, skipped } = parseCcSwitchConfig(V3_CONFIG);
    expect(providers.some((p) => p.name === '官方登录')).toBe(false);
    expect(skipped).toBe(1);
  });

  it('多个 ANTHROPIC_*_MODEL 变成多条对话模型，重复的合一', () => {
    const { providers } = parseCcSwitchConfig({
      x: {
        name: '多模型',
        settingsConfig: {
          env: {
            ANTHROPIC_API_KEY: 'k',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4',
            ANTHROPIC_SMALL_FAST_MODEL: 'claude-sonnet-4',
          },
        },
      },
    });
    expect(providers[0].chatModels.map((m) => m.modelName)).toEqual([
      'claude-opus-4',
      'claude-sonnet-4',
    ]);
  });

  it('一个模型名都没写时退回该类型的预设模型，而不是留空', () => {
    const { providers } = parseCcSwitchConfig({
      x: { name: '无模型', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'k' } } },
    });
    expect(providers[0].chatModels[0].modelName).toBeTruthy();
  });

  it('认 api.openai.com 与 deepseek，其余归 custom', () => {
    const kindOf = (baseUrl: string) =>
      parseCcSwitchConfig({
        x: {
          name: 'n',
          settingsConfig: {
            auth: { OPENAI_API_KEY: 'k' },
            config: `base_url = "${baseUrl}"\n`,
          },
        },
      }).providers[0].kind;

    expect(kindOf('https://api.openai.com/v1')).toBe('openai');
    expect(kindOf('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(kindOf('https://whatever.example.com/v1')).toBe('custom');
  });

  it('外层包装换一层（v2 的 providers 直挂根上）也照样读得出来', () => {
    const v2 = {
      providers: [
        {
          id: 'a',
          name: '旧版条目',
          settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-old' } },
        },
      ],
    };
    expect(parseCcSwitchConfig(v2).providers[0].apiKey).toBe('sk-old');
  });

  it('同类型 + 同地址 + 同密钥只留一条', () => {
    const dupe = {
      a: { name: '甲', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'k', ANTHROPIC_BASE_URL: 'https://x' } } },
      b: { name: '乙', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'k', ANTHROPIC_BASE_URL: 'https://x' } } },
    };
    expect(parseCcSwitchConfig(dupe).providers).toHaveLength(1);
  });

  it('不认识的输入不抛错，返回空结果', () => {
    expect(parseCcSwitchConfig(null)).toEqual({ providers: [], skipped: 0 });
    expect(parseCcSwitchConfig('nope')).toEqual({ providers: [], skipped: 0 });
    expect(parseCcSwitchConfig({ unrelated: { a: 1 } })).toEqual({ providers: [], skipped: 0 });
  });

  it('自引用的对象不会把递归卡死', () => {
    const cyclic: Record<string, unknown> = {
      name: '循环',
      settingsConfig: { env: { ANTHROPIC_API_KEY: 'k' } },
    };
    cyclic.self = cyclic;
    expect(parseCcSwitchConfig(cyclic).providers).toHaveLength(1);
  });
});

describe('mergeCcSwitchProviders', () => {
  const empty: AIConfigV2 = {
    version: 2,
    providers: [],
    activeChat: { providerId: '', modelId: '' },
  };

  it('原本没有服务商时，第一条导入的成为当前对话模型', () => {
    const { providers } = parseCcSwitchConfig(V3_CONFIG);
    const merged = mergeCcSwitchProviders(empty, providers);
    expect(merged.added).toBe(2);
    expect(merged.config.activeChat.providerId).toBe(providers[0].id);
    expect(merged.config.activeChat.modelId).toBe(providers[0].chatModels[0].id);
  });

  it('已有配置只追加，不覆盖，也不动 activeChat', () => {
    const existing: AIConfigV2 = {
      version: 2,
      providers: [
        {
          id: 'mine',
          name: '我自己配的',
          kind: 'deepseek',
          apiKey: 'sk-mine',
          baseUrl: 'https://api.deepseek.com/v1',
          chatModels: [{ id: 'm', modelName: 'deepseek-chat', label: 'DeepSeek' }],
          imageModels: [],
        },
      ],
      activeChat: { providerId: 'mine', modelId: 'm' },
    };
    const { providers } = parseCcSwitchConfig(V3_CONFIG);
    const merged = mergeCcSwitchProviders(existing, providers);

    expect(merged.config.providers[0]).toBe(existing.providers[0]);
    expect(merged.config.providers).toHaveLength(3);
    expect(merged.config.activeChat).toEqual({ providerId: 'mine', modelId: 'm' });
  });

  it('重复导入同一个文件不会越点越多', () => {
    const first = mergeCcSwitchProviders(empty, parseCcSwitchConfig(V3_CONFIG).providers);
    const second = mergeCcSwitchProviders(first.config, parseCcSwitchConfig(V3_CONFIG).providers);

    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.config.providers).toHaveLength(2);
    // 一条都没加就把原配置原样返回，别制造无谓的重渲染
    expect(second.config).toBe(first.config);
  });
});
