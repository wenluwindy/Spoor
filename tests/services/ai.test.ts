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
      ).rejects.toThrow('API Key missing');
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

    it('uses builtin key when user apiKey empty', async () => {
      vi.stubEnv('VITE_BUILTIN_MIMO_API_KEY', 'tp-builtin-test');
      const result = await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'mimo',
          apiKey: '',
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
            Authorization: 'Bearer tp-builtin-test',
          }),
        }),
      );
    });

    it('throws when no user key and no builtin', async () => {
      vi.stubEnv('VITE_BUILTIN_MIMO_API_KEY', '');
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'mimo', apiKey: '' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow(/MiMo API Key/);
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

    it('uses builtin key when user apiKey empty', async () => {
      vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', 'ark-builtin-test');
      const result = await callUniversalAI({
        config: {
          ...baseConfig,
          provider: 'doubao',
          apiKey: '',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          model: 'ep-20260218175314-xrnrn',
        },
        prompt: 'Hello Doubao',
      });
      expect(result).toBe('Doubao response');
      expect(fetch).toHaveBeenCalledWith(
        '/api/doubao/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ark-builtin-test',
          }),
        }),
      );
    });

    it('throws when no user key and no builtin', async () => {
      vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', '');
      await expect(
        callUniversalAI({
          config: { ...baseConfig, provider: 'doubao', apiKey: '' },
          prompt: 'Hello',
        }),
      ).rejects.toThrow(/豆包|托管豆包/);
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
      ).rejects.toThrow('Unauthorized');
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
      ).rejects.toThrow('Forbidden');
    });
  });

  // --- Local llama (Tauri subprocess) ---
  describe('local_llama provider', () => {
    const localBase = {
      ...baseConfig,
      provider: 'local_llama',
      apiKey: '',
      localGgufPath: 'D:\\Models\\m.gguf',
    };

    let savedTauri: unknown;

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
      ).rejects.toThrow('Tauri 桌面版');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('localGgufPath 为空时抛错（不调用任何 Tauri 命令）', async () => {
      await expect(
        callUniversalAI({
          config: { ...localBase, localGgufPath: '' },
          prompt: 'hi',
        })
      ).rejects.toThrow('请在设置中填写本地 GGUF');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('localGgufPath 仅含空格时也视为空', async () => {
      await expect(
        callUniversalAI({
          config: { ...localBase, localGgufPath: '   \t  ' },
          prompt: 'hi',
        })
      ).rejects.toThrow('请在设置中填写本地 GGUF');
    });

    it('附带 images 时抛错且不调用 invoke', async () => {
      await expect(
        callUniversalAI({
          config: localBase,
          prompt: 'hi',
          images: ['data:image/png;base64,AAAA'],
        })
      ).rejects.toThrow('不支持');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('调用 local_llama_chat 时 payload 形状与字段映射正确', async () => {
      mockInvoke
        .mockResolvedValueOnce('D:\\TEMP\\spoor_llama.log') // get_local_llama_log_path
        .mockResolvedValueOnce('local response'); // local_llama_chat

      const result = await callUniversalAI({
        config: { ...localBase, localEnableThinking: true },
        prompt: 'Hello local',
        systemInstruction: 'be brief',
        temperature: 0.5,
        topP: 0.8,
      });

      expect(result).toBe('local response');

      // 第一次调用：拿日志路径
      expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_local_llama_log_path');

      // 第二次调用：实际推理，payload 形状必须严格匹配 Rust 端 LocalLlamaChatPayload
      expect(mockInvoke).toHaveBeenNthCalledWith(2, 'local_llama_chat', {
        payload: {
          modelPath: 'D:\\Models\\m.gguf',
          systemInstruction: 'be brief',
          userMessage: 'Hello local',
          temperature: 0.5,
          topP: 0.8,
          maxTokens: 256,
          nCtx: 1024,
          enableThinking: true,
        },
      });
    });

    it('未提供 systemInstruction 时 payload 中应为 null（不能是 undefined）', async () => {
      mockInvoke
        .mockResolvedValueOnce('logpath')
        .mockResolvedValueOnce('out');

      await callUniversalAI({ config: localBase, prompt: 'hi' });

      const chatCall = mockInvoke.mock.calls.find((c) => c[0] === 'local_llama_chat');
      const payload = (chatCall?.[1] as { payload: Record<string, unknown> } | undefined)?.payload;
      expect(payload?.systemInstruction).toBeNull();
    });

    it('localEnableThinking 未设置时默认 false', async () => {
      mockInvoke
        .mockResolvedValueOnce('logpath')
        .mockResolvedValueOnce('out');

      await callUniversalAI({ config: localBase, prompt: 'hi' });

      const chatCall = mockInvoke.mock.calls.find((c) => c[0] === 'local_llama_chat');
      const payload = (chatCall?.[1] as { payload: Record<string, unknown> } | undefined)?.payload;
      expect(payload?.enableThinking).toBe(false);
    });

    it('使用调用方传入的 temperature/topP；不传则用默认 0.7/0.4', async () => {
      mockInvoke
        .mockResolvedValueOnce('logpath')
        .mockResolvedValueOnce('out');

      await callUniversalAI({ config: localBase, prompt: 'hi' });

      const chatCall = mockInvoke.mock.calls.find((c) => c[0] === 'local_llama_chat');
      const payload = (chatCall?.[1] as { payload: Record<string, unknown> } | undefined)?.payload;
      expect(payload?.temperature).toBe(0.7);
      expect(payload?.topP).toBe(0.4);
    });

    it('推理失败时错误消息附带日志路径', async () => {
      mockInvoke
        .mockResolvedValueOnce('D:\\TEMP\\spoor_llama.log')
        .mockRejectedValueOnce(new Error('cudaMalloc failed: out of memory'));

      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(/out of memory[\s\S]*详细日志[\s\S]*spoor_llama\.log/);
    });

    it('get_local_llama_log_path 调用失败时不应中断主流程', async () => {
      // 第一次（拿日志路径）失败，第二次（实际推理）成功
      mockInvoke
        .mockRejectedValueOnce(new Error('command not found'))
        .mockResolvedValueOnce('still works');

      const result = await callUniversalAI({ config: localBase, prompt: 'hi' });
      expect(result).toBe('still works');
    });

    it('日志路径不可得且推理也失败时，错误消息不应带空 suffix', async () => {
      mockInvoke
        .mockRejectedValueOnce(new Error('no log cmd'))
        .mockRejectedValueOnce(new Error('inference exploded'));

      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(/^inference exploded$/);
    });

    it('Tauri 端返回非 Error 异常（字符串/对象）也能正确格式化', async () => {
      mockInvoke
        .mockResolvedValueOnce('logpath')
        .mockRejectedValueOnce('plain string error from rust');

      await expect(
        callUniversalAI({ config: localBase, prompt: 'hi' })
      ).rejects.toThrow(/plain string error from rust[\s\S]*详细日志/);
    });

    it('modelPath 前后含空格时应被 trim 后再下发', async () => {
      mockInvoke
        .mockResolvedValueOnce('logpath')
        .mockResolvedValueOnce('out');

      await callUniversalAI({
        config: { ...localBase, localGgufPath: '   D:\\Models\\m.gguf  \t' },
        prompt: 'hi',
      });

      const chatCall = mockInvoke.mock.calls.find((c) => c[0] === 'local_llama_chat');
      const payload = (chatCall?.[1] as { payload: Record<string, unknown> } | undefined)?.payload;
      expect(payload?.modelPath).toBe('D:\\Models\\m.gguf');
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
      ).rejects.toThrow('Provider not supported');
    });
  });
});
