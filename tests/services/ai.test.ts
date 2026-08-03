import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn().mockResolvedValue({ text: 'Gemini response' });

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// 流式通道在 Tauri 运行时会订阅 'lab-ai-stream' 事件；测试里不发增量，只验请求形状
const mockListen = vi.fn().mockResolvedValue(() => {});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { callUniversalAI, parseImageDataUrl } from '../../src/services/ai';

const baseConfig = {
  provider: 'gemini',
  apiKey: 'test-key',
  baseUrl: '',
  model: 'gemini-1.5-flash',
};

describe('callUniversalAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseImageDataUrl', () => {
    it('解析合法 data URL', () => {
      const u = 'data:image/png;base64,QUJD';
      expect(parseImageDataUrl(u)).toEqual({ mediaType: 'image/png', base64: 'QUJD' });
    });
    it('非 base64 或前缀不对时返回 null', () => {
      expect(parseImageDataUrl('https://ex.com/a.png')).toBeNull();
      expect(parseImageDataUrl('data:text/plain;base64,QQ==')).toBeNull();
    });
  });

  // --- Gemini ---
  describe('Gemini provider', () => {
    it('使用用户 apiKey 调用 Gemini', async () => {
      const result = await callUniversalAI({
        config: baseConfig,
        prompt: 'Hello Gemini',
      });
      expect(result).toBe('Gemini response');
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-1.5-flash',
          contents: 'Hello Gemini',
        })
      );
    });

    it('传递 systemInstruction 给 Gemini', async () => {
      mockGenerateContent.mockClear();
      await callUniversalAI({
        config: baseConfig,
        prompt: 'Hello',
        systemInstruction: 'You are helpful',
      });
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ systemInstruction: 'You are helpful' }),
        })
      );
    });

    it('使用用户 model 参数', async () => {
      mockGenerateContent.mockClear();
      await callUniversalAI({
        config: { ...baseConfig, model: 'gemini-2.0-flash' },
        prompt: 'Hello',
      });
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-flash' })
      );
    });

    it('多模态时 contents 为 text + inlineData parts', async () => {
      mockGenerateContent.mockClear();
      const png = 'data:image/png;base64,QUJD';
      await callUniversalAI({
        config: baseConfig,
        prompt: 'Describe',
        images: [png, 'bad-url-ignored'],
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const arg = mockGenerateContent.mock.calls[0][0] as {
        contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      };
      expect(Array.isArray(arg.contents)).toBe(true);
      expect(arg.contents[0]).toEqual({ text: 'Describe' });
      expect(arg.contents[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'QUJD' } });
      expect(arg.contents.length).toBe(2);
    });

    it('apiKey 为空且无环境变量时抛错', async () => {
      const original = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      await expect(
        callUniversalAI({
          config: { ...baseConfig, apiKey: '' },
          prompt: 'Hello',
        })
      ).rejects.toThrow('ai.no_api_key');
      process.env.GEMINI_API_KEY = original;
    });
  });

  // --- MiMo (builtin key) ---
  describe('MiMo provider', () => {
    beforeEach(() => {
      const okBody = JSON.stringify({
        choices: [{ message: { content: 'MiMo response' } }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses the user key', async () => {
      const result = await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'mimo',
          apiKey: 'tp-user-key',
          baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
          model: 'mimo-v2.5-pro',
        },
        prompt: 'Hello MiMo',
      });
      expect(result).toBe('MiMo response');
      expect(fetch).toHaveBeenCalledWith(
        '/api/mimo/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tp-user-key',
          }),
        }),
      );
    });

    it('throws when the key is missing (no built-in fallback any more)', async () => {
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'mimo', apiKey: '' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow('ai.no_api_key');
    });
  });

  // --- Doubao (builtin key) ---
  describe('Doubao provider', () => {
    beforeEach(() => {
      const okBody = JSON.stringify({
        choices: [{ message: { content: 'Doubao response' } }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses the user key and their own inference endpoint id', async () => {
      const result = await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'doubao',
          apiKey: 'ark-user-key',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          model: 'ep-user-endpoint',
        },
        prompt: 'Hello Doubao',
      });
      expect(result).toBe('Doubao response');
      expect(fetch).toHaveBeenCalledWith(
        '/api/doubao/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ark-user-key',
          }),
          body: expect.stringContaining('ep-user-endpoint'),
        }),
      );
    });

    it('throws when the key is missing (no built-in fallback any more)', async () => {
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'doubao', apiKey: '' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow('ai.no_api_key');
    });

    it('throws a pointed error when the endpoint id is blank', async () => {
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'doubao', apiKey: 'ark-user-key', model: '' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow('ai.doubao_needs_endpoint');
    });
  });

  // --- DeepSeek ---
  describe('DeepSeek provider', () => {
    beforeEach(() => {
      const okBody = JSON.stringify({
        choices: [{ message: { content: 'DeepSeek response' } }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
    });

    it('uses same-origin DeepSeek proxy in web runtime', async () => {
      const result = await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'deepseek',
          apiKey: 'sk-deepseek-test',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
        },
        prompt: 'Hello DeepSeek',
      });
      expect(result).toBe('DeepSeek response');
      expect(fetch).toHaveBeenCalledWith(
        '/api/deepseek/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-deepseek-test',
          }),
        }),
      );
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('deepseek-chat');
    });
  });

  // --- OpenAI ---
  describe('OpenAI provider', () => {
    beforeEach(() => {
      const okBody = JSON.stringify({
        choices: [{ message: { content: 'OpenAI response' } }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
    });

    it('调用 OpenAI endpoint 返回内容', async () => {
      const result = await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test' },
        prompt: 'Hello OpenAI',
      });
      expect(result).toBe('OpenAI response');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/completions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test',
          }),
        })
      );
    });

    it('使用自定义 baseUrl', async () => {
      await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test', baseUrl: 'http://localhost:8080/v1' },
        prompt: 'Hello',
      });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        expect.anything()
      );
    });

    it('API 返回非 200 时抛错', async () => {
      const errorBody = JSON.stringify({ error: { message: 'Unauthorized' } });
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => errorBody,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      } as any);
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'openai', apiKey: 'bad-key' },
          prompt: 'Hello',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'ai.http', detail: expect.stringContaining('Unauthorized') }));
    });

    it('onStreamChunk 在 OpenAI SSE 流式响应时增量累积', async () => {
      const enc = new TextEncoder();
      const sse =
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
        'data: [DONE]\n\n';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(sse));
              controller.close();
            },
          }),
        }),
      );
      const acc: string[] = [];
      const result = await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test' },
        prompt: 'Hi',
        onStreamChunk: (t) => acc.push(t),
      });
      expect(acc).toEqual(['Hello', 'Hello world']);
      expect(result).toBe('Hello world');
      const reqBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(reqBody.stream).toBe(true);
    });

    it('传递 systemInstruction 给 OpenAI', async () => {
      await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test' },
        prompt: 'Hello',
        systemInstruction: 'You are a bot',
      });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a bot' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('多模态时 user content 为 text + image_url 数组', async () => {
      vi.mocked(fetch).mockClear();
      const png = 'data:image/png;base64,QUJD';
      await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test' },
        prompt: 'What is this',
        images: [png],
      });
      const calls = vi.mocked(fetch).mock.calls;
      const body = JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string);
      const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.role).toBe('user');
      expect(userMsg.content).toEqual([
        { type: 'text', text: 'What is this' },
        { type: 'image_url', image_url: { url: png } },
      ]);
    });

    it('流式请求在带 images 时 body 仍为 multipart user 且 stream 为 true', async () => {
      vi.mocked(fetch).mockClear();
      const enc = new TextEncoder();
      const sse = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + 'data: [DONE]\n\n';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(sse));
              controller.close();
            },
          }),
        }),
      );
      const png = 'data:image/jpeg;base64,WFhY';
      await callUniversalAI({
        config: { ...baseConfig, provider: 'openai', apiKey: 'sk-test' },
        prompt: 'p',
        images: [png],
        onStreamChunk: () => {},
      });
      const calls = vi.mocked(fetch).mock.calls;
      const reqBody = JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string);
      expect(reqBody.stream).toBe(true);
      const userMsg = reqBody.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toEqual([
        { type: 'text', text: 'p' },
        { type: 'image_url', image_url: { url: png } },
      ]);
    });
  });

  // --- 采样参数写死的模型 ---
  describe('固定采样参数的模型', () => {
    const okBody = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
    const okResponse = () => ({
      ok: true,
      text: async () => okBody,
      json: async () => JSON.parse(okBody),
    });
    const rejectSampling = () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message: 'invalid temperature: only 1 is allowed for this model',
            type: 'invalid_request_error',
          },
        }),
    });

    const kimi = {
      ...baseConfig,
      provider: 'custom',
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.5',
    };

    it('名单里的模型第一次就不带 temperature / top_p', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
      await callUniversalAI({ config: kimi, prompt: 'ping' });

      expect(fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('kimi-k2.5');
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('top_p');
    });

    it('名单外的模型被拒后去掉采样参数重试一次', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(rejectSampling())
          .mockResolvedValueOnce(okResponse()),
      );

      const result = await callUniversalAI({
        config: { ...kimi, model: 'glm-5-brand-new' },
        prompt: 'ping',
      });

      expect(result).toBe('ok');
      expect(fetch).toHaveBeenCalledTimes(2);
      const first = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      const second = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
      expect(first.temperature).toBe(0.7);
      expect(second).not.toHaveProperty('temperature');
      expect(second).not.toHaveProperty('top_p');
    });

    it('不是采样参数的报错不重试，原样抛出', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
        }),
      );

      await expect(
        callUniversalAI({ config: { ...kimi, model: 'moonshot-v1-8k' }, prompt: 'ping' }),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'ai.http', detail: expect.stringContaining('Invalid API key') }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('去掉采样参数后仍然失败时只重试一次，不无限循环', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rejectSampling()));

      await expect(
        callUniversalAI({ config: { ...kimi, model: 'glm-5-brand-new' }, prompt: 'ping' }),
      ).rejects.toThrow(expect.objectContaining({ code: 'ai.http' }));
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  // --- Custom provider (same as OpenAI) ---
  describe('Custom provider', () => {
    it('custom provider 走 OpenAI 兼容路径', async () => {
      const okBody = JSON.stringify({
        choices: [{ message: { content: 'Custom response' } }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
      const result = await callUniversalAI({
        config: { ...baseConfig, provider: 'custom', apiKey: 'custom-key', baseUrl: 'http://custom.api/v1' },
        prompt: 'Hello',
      });
      expect(result).toBe('Custom response');
    });

    it('custom + images 时 user 仍为 multipart 数组', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: async () =>
            JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        }),
      );
      const png = 'data:image/png;base64,QUJD';
      await callUniversalAI({
        config: { ...baseConfig, provider: 'custom', apiKey: 'k', baseUrl: 'http://custom.api/v1' },
        prompt: 'x',
        images: [png],
      });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
      expect(body.messages[0]).toEqual({ role: 'user', content: expect.any(Array) });
      expect((body.messages[0].content as unknown[])[1]).toEqual({
        type: 'image_url',
        image_url: { url: png },
      });
    });
  });

  // --- Anthropic ---
  describe('Anthropic provider', () => {
    beforeEach(() => {
      const okBody = JSON.stringify({
        content: [{ text: 'Anthropic response' }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => okBody,
        json: async () => JSON.parse(okBody),
      }));
    });

    it('调用 Anthropic endpoint 返回内容', async () => {
      const result = await callUniversalAI({
        config: { ...baseConfig, provider: 'anthropic', apiKey: 'sk-ant-test' },
        prompt: 'Hello Claude',
      });
      expect(result).toBe('Anthropic response');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('anthropic.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test',
          }),
        })
      );
    });

    it('传递 system 给 Anthropic', async () => {
      await callUniversalAI({
        config: { ...baseConfig, provider: 'anthropic', apiKey: 'sk-ant-test' },
        prompt: 'Hello',
        systemInstruction: 'Be concise',
      });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string);
      expect(body.system).toBe('Be concise');
    });

    it('多模态时 user 为 text + base64 image blocks', async () => {
      vi.mocked(fetch).mockClear();
      const png = 'data:image/png;base64,QUJD';
      await callUniversalAI({
        config: { ...baseConfig, provider: 'anthropic', apiKey: 'sk-ant-test' },
        prompt: 'Caption',
        images: [png],
      });
      const calls = vi.mocked(fetch).mock.calls;
      const body = JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'Caption' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
        },
      ]);
    });

    it('API 返回非 200 时抛错', async () => {
      const errorBody = JSON.stringify({ error: { message: 'Forbidden' } });
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => errorBody,
        json: async () => ({ error: { message: 'Forbidden' } }),
      } as any);
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'anthropic', apiKey: 'bad-key' },
          prompt: 'Hello',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'ai.http', detail: expect.stringContaining('Forbidden') }));
    });

    it('浏览器直连要带 anthropic-dangerous-direct-browser-access，否则 CORS 预检就死了', async () => {
      await callUniversalAI({
        config: { ...baseConfig, provider: 'anthropic', apiKey: 'sk-ant-test' },
        prompt: 'Hello',
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'anthropic-dangerous-direct-browser-access': 'true',
          }),
        }),
      );
    });

    it('自定义 Base URL：不含 /v1 的站点根会自动补上', async () => {
      await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'anthropic',
          apiKey: 'sk-ant-test',
          baseUrl: 'https://relay.example.com',
        },
        prompt: 'Hello',
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://relay.example.com/v1/messages',
        expect.anything(),
      );
    });

    it('自定义 Base URL：已经含 /v1 的不重复追加', async () => {
      await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'anthropic',
          apiKey: 'sk-ant-test',
          baseUrl: 'https://relay.example.com/v1/',
        },
        prompt: 'Hello',
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://relay.example.com/v1/messages',
        expect.anything(),
      );
    });

    it('网络层直接失败时归为 ai.network，而不是含糊的 ai.http', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'anthropic', apiKey: 'sk-ant-test' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'ai.network' }));
    });

    it('桌面端走 Rust 命令，绕开 CORS，完全不碰 fetch', async () => {
      const saved = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { __mock: true };
      mockInvoke.mockReset();
      mockInvoke.mockResolvedValue(JSON.stringify({ content: [{ text: 'from rust' }] }));
      try {
        const result = await callUniversalAI({
          config: {
            ...baseConfig,
            provider: 'anthropic',
            apiKey: 'sk-ant-test',
            baseUrl: 'https://relay.example.com',
          },
          prompt: 'Hello',
        });
        expect(result).toBe('from rust');
        expect(fetch).not.toHaveBeenCalled();
        expect(mockInvoke).toHaveBeenCalledWith('anthropic_messages', {
          apiKey: 'sk-ant-test',
          url: 'https://relay.example.com/v1/messages',
          body: expect.objectContaining({ model: 'gemini-1.5-flash' }),
        });
      } finally {
        if (saved === undefined) {
          delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
        } else {
          (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = saved;
        }
      }
    });
  });

  // --- Local llama（llama-server 常驻 + OpenAI 兼容通道） ---
  describe('local_llama provider', () => {
    const GiB = 1024 ** 3;
    const localBase = {
      ...baseConfig,
      provider: 'local_llama',
      apiKey: '',
      localGgufPath: 'D:\\Models\\m.gguf',
    };

    const ggufInfo = {
      fileBytes: 4 * GiB,
      version: 3,
      tensorCount: 291,
      architecture: 'llama',
      modelName: 'Test 8B',
      blockCount: 32,
      contextLength: 32768,
      embeddingLength: 4096,
      headCount: 32,
      headCountKv: 8,
      hasChatTemplate: true,
    };
    // 4GB N 卡 + 8B Q4：规划器给 17 层 / 4096 ctx / 8 线程（见 localModelPlanner.test.ts）
    const hardwareInfo = {
      totalRamBytes: 16 * GiB,
      availableRamBytes: 8 * GiB,
      physicalCores: 8,
      logicalCores: 16,
      gpus: [{ name: 'RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
      platform: 'windows',
      unifiedMemory: false,
    };

    let savedTauri: unknown;

    const invokedCmds = () => mockInvoke.mock.calls.map((c) => c[0]);
    const invokeArgsOf = (cmd: string, nth = 0) =>
      mockInvoke.mock.calls.filter((c) => c[0] === cmd)[nth]?.[1] as
        | Record<string, unknown>
        | undefined;

    /** 全链路 happy path 的 invoke 桩；单测里再按需覆盖个别命令。 */
    function mockLocalInvoke(patch: Record<string, (args?: Record<string, unknown>) => Promise<unknown>> = {}) {
      mockInvoke.mockImplementation((cmd: unknown, args: unknown) => {
        const override = patch[cmd as string];
        if (override) return override(args as Record<string, unknown>);
        switch (cmd) {
          case 'gguf_inspect':
            return Promise.resolve(ggufInfo);
          case 'hardware_probe':
            return Promise.resolve(hardwareInfo);
          case 'local_engine_status':
            return Promise.resolve({
              installed: true,
              backend: 'cuda',
              path: 'C:\\x\\llama-server.exe',
              nvidiaDetected: true,
              cudaInstalled: true,
            });
          case 'local_server_ensure':
            return Promise.resolve({ port: 8123, restarted: false });
          case 'local_server_touch':
          case 'local_server_stop':
            return Promise.resolve(null);
          case 'openai_compatible_chat':
            return Promise.resolve('local response');
          default:
            return Promise.reject(new Error(`unexpected invoke: ${String(cmd)}`));
        }
      });
    }

    beforeEach(() => {
      savedTauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { __mock: true };
      mockInvoke.mockReset();
    });

    afterEach(() => {
      if (savedTauri === undefined) {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      } else {
        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = savedTauri;
      }
    });

    it('在网页环境（无 __TAURI_INTERNALS__）时应抛错而不调用 invoke', async () => {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow('ai.local_desktop_only');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('localGgufPath 为空或仅含空格时抛错（不调用任何 Tauri 命令）', async () => {
      await expect(
        callUniversalAI({ config: { ...localBase, localGgufPath: '' }, prompt: 'hi' })
      ).rejects.toThrow('ai.local_no_path');
      await expect(
        callUniversalAI({ config: { ...localBase, localGgufPath: '   \t  ' }, prompt: 'hi' })
      ).rejects.toThrow('ai.local_no_path');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('附带 images 时抛错且不调用 invoke', async () => {
      await expect(
        callUniversalAI({
          config: localBase,
          prompt: 'hi',
          images: ['data:image/png;base64,AAAA'],
        })
      ).rejects.toThrow('ai.local_no_images');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('全链路：规划 → ensure → touch → OpenAI 兼容请求 → touch', async () => {
      mockLocalInvoke();

      const result = await callUniversalAI({
        config: { ...localBase, localEnableThinking: true },
        prompt: 'Hello local',
        systemInstruction: 'be brief',
        temperature: 0.5,
        topP: 0.8,
      });

      expect(result).toBe('local response');
      expect(invokedCmds()).toEqual([
        'gguf_inspect',
        'hardware_probe',
        'local_engine_status',
        'local_server_ensure',
        'local_server_touch',
        'openai_compatible_chat',
        'local_server_touch',
      ]);

      // ensure：规划器输出直接下发；keepAlive 未配置时不带该字段（Rust 用默认 15 分钟）
      const ensureArgs = invokeArgsOf('local_server_ensure');
      expect(ensureArgs).toEqual({
        modelPath: 'D:\\Models\\m.gguf',
        nGpuLayers: 17,
        nCtx: 4096,
        nThreads: 8,
      });

      // 对话：走 server 的 OpenAI 兼容接口，api key 固定 'local'，多轮消息结构与 openai 分支一致
      const chatArgs = invokeArgsOf('openai_compatible_chat');
      expect(chatArgs?.apiKey).toBe('local');
      expect(chatArgs?.url).toBe('http://127.0.0.1:8123/v1/chat/completions');
      const body = chatArgs?.body as Record<string, unknown>;
      expect(body.messages).toEqual([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'Hello local' },
      ]);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.8);
      expect(body.max_tokens).toBe(1024);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('无 systemInstruction 时只有 user 消息；enableThinking 缺省为 false', async () => {
      mockLocalInvoke();
      await callUniversalAI({ config: localBase, prompt: 'hi' });
      const body = invokeArgsOf('openai_compatible_chat')?.body as Record<string, unknown>;
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it('手动覆盖参数直接下发：层数/上下文/线程给 ensure，maxTokens 进请求体', async () => {
      mockLocalInvoke();
      await callUniversalAI({
        config: { ...localBase, localNGpuLayers: 8, localNCtx: 2048, localNThreads: 4, localMaxTokens: 256 },
        prompt: 'hi',
      });
      expect(invokeArgsOf('local_server_ensure')).toEqual({
        modelPath: 'D:\\Models\\m.gguf',
        nGpuLayers: 8,
        nCtx: 2048,
        nThreads: 4,
      });
      const body = invokeArgsOf('openai_compatible_chat')?.body as Record<string, unknown>;
      expect(body.max_tokens).toBe(256);
    });

    it('keepAlive=0（用后即退）：下发 0 且完成后调用 local_server_stop', async () => {
      mockLocalInvoke();
      await callUniversalAI({
        config: { ...localBase, localKeepAliveMinutes: 0 },
        prompt: 'hi',
      });
      expect(invokeArgsOf('local_server_ensure')?.keepAliveMinutes).toBe(0);
      expect(invokedCmds()).toContain('local_server_stop');
      // stop 在收尾 touch 之后
      expect(invokedCmds().at(-1)).toBe('local_server_stop');
    });

    it('keepAlive=null（会话期常驻）：以 -1 下发且不 stop；数字原样透传', async () => {
      mockLocalInvoke();
      await callUniversalAI({
        config: { ...localBase, localKeepAliveMinutes: null },
        prompt: 'hi',
      });
      expect(invokeArgsOf('local_server_ensure')?.keepAliveMinutes).toBe(-1);
      expect(invokedCmds()).not.toContain('local_server_stop');

      mockInvoke.mockReset();
      mockLocalInvoke();
      await callUniversalAI({
        config: { ...localBase, localKeepAliveMinutes: 30 },
        prompt: 'hi',
      });
      expect(invokeArgsOf('local_server_ensure')?.keepAliveMinutes).toBe(30);
    });

    it('ensure 报 oom 时自动降 25% 层数重试一次', async () => {
      let ensureCalls = 0;
      mockLocalInvoke({
        local_server_ensure: () => {
          ensureCalls += 1;
          return ensureCalls === 1
            ? Promise.reject('oom')
            : Promise.resolve({ port: 8123, restarted: true });
        },
      });

      const result = await callUniversalAI({ config: localBase, prompt: 'hi' });
      expect(result).toBe('local response');
      expect(invokeArgsOf('local_server_ensure', 0)?.nGpuLayers).toBe(17);
      // floor(17 × 0.75) = 12
      expect(invokeArgsOf('local_server_ensure', 1)?.nGpuLayers).toBe(12);
    });

    it('降层重试仍 oom 时归为 ai.local_failed，不无限重试', async () => {
      mockLocalInvoke({ local_server_ensure: () => Promise.reject('oom') });
      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(expect.objectContaining({ code: 'ai.local_failed' }));
      expect(invokedCmds().filter((c) => c === 'local_server_ensure')).toHaveLength(2);
    });

    it('ensure 的非 oom 失败原样归为 ai.local_failed，不重试', async () => {
      mockLocalInvoke({
        local_server_ensure: () => Promise.reject(new Error('spawn failed: engine missing')),
      });
      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'ai.local_failed',
          detail: expect.stringContaining('spawn failed'),
        }),
      );
      expect(invokedCmds().filter((c) => c === 'local_server_ensure')).toHaveLength(1);
    });

    it('GGUF 解析失败当场报 ai.local_gguf_invalid，不去起 server', async () => {
      mockLocalInvoke({ gguf_inspect: () => Promise.reject('not_a_gguf') });
      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'ai.local_gguf_invalid',
          detail: expect.stringContaining('not_a_gguf'),
        }),
      );
      expect(invokedCmds()).not.toContain('local_server_ensure');
    });

    it('hardware_probe 失败时退回保守 CPU 方案（0 层 / 1024 ctx / 4 线程），对话照走', async () => {
      mockLocalInvoke({ hardware_probe: () => Promise.reject(new Error('probe crashed')) });
      const result = await callUniversalAI({ config: localBase, prompt: 'hi' });
      expect(result).toBe('local response');
      expect(invokeArgsOf('local_server_ensure')).toEqual({
        modelPath: 'D:\\Models\\m.gguf',
        nGpuLayers: 0,
        nCtx: 1024,
        nThreads: 4,
      });
    });

    it('modelPath 前后空格 trim 后再下发', async () => {
      mockLocalInvoke();
      await callUniversalAI({
        config: { ...localBase, localGgufPath: '   D:\\Models\\m.gguf  \t' },
        prompt: 'hi',
      });
      expect(invokeArgsOf('local_server_ensure')?.modelPath).toBe('D:\\Models\\m.gguf');
      expect(invokeArgsOf('gguf_inspect')?.path).toBe('D:\\Models\\m.gguf');
    });

    it('带 onStreamChunk 时走流式通道（openai_compatible_chat_stream，body.stream=true）', async () => {
      mockLocalInvoke({
        openai_compatible_chat_stream: () => Promise.resolve('streamed response'),
      });
      const result = await callUniversalAI({
        config: localBase,
        prompt: 'hi',
        onStreamChunk: () => {},
      });
      expect(result).toBe('streamed response');
      const args = invokeArgsOf('openai_compatible_chat_stream');
      expect(args?.apiKey).toBe('local');
      expect(args?.url).toBe('http://127.0.0.1:8123/v1/chat/completions');
      expect((args?.body as Record<string, unknown>).stream).toBe(true);
      expect(mockListen).toHaveBeenCalledWith('lab-ai-stream', expect.any(Function));
    });
  });

  // --- Unsupported provider ---
  describe('不支持的 provider', () => {
    it('抛出 provider not supported 错误', async () => {
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'invalid-provider', apiKey: 'key' },
          prompt: 'Hello',
        })
      ).rejects.toThrow('ai.provider_unsupported');
    });
  });
});
