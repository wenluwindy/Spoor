import { GoogleGenAI } from '@google/genai';
import { MIMO_TOKEN_PLAN_BASE_URL } from '../constants/mimo';
import { DOUBAO_ARK_BASE_URL } from '../constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../constants/deepseek';
import { ANTHROPIC_BASE_URL } from '../constants/aiProviderPresets';
import { looksLikeSamplingRejection, modelRejectsSampling } from '../utils/samplingParams';
import { AppError, isAppError } from './appError';
import {
  planLocalRun,
  type GgufInfo,
  type HardwareInfo,
  type LocalRunPlan,
} from './localModelPlanner';
import { logger } from '../utils/logger';

/** For logs only — never log full API keys. */
export function maskApiKeyForLog(key: string | undefined): string {
  if (!key?.trim()) return '(empty)';
  const k = key.trim();
  if (k.length <= 12) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

export function formatAiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * 把 Rust 代理（`openai_compatible_chat*` / `anthropic_messages`）抛回的字符串
 * 翻成带错误码的 `AppError`。
 *
 * Rust 侧有两个自家的守卫错误，不是服务商回的 HTTP 错误体，得单独认出来：
 * - `insecure_url: …`——Base URL 不是 https（http 仅限本机），密钥不允许明文出门；
 * - `response_too_large`——响应体超过 Rust 侧的读入上限。
 * 其余仍归入 `ai.http`，原文作为详情。
 */
function appErrorFromProxyFailure(msg: string): AppError {
  if (msg.startsWith('insecure_url:')) {
    return new AppError('ai.insecure_url', msg.slice('insecure_url:'.length).trim());
  }
  if (msg === 'response_too_large') {
    return new AppError('ai.response_too_large');
  }
  return new AppError('ai.http', msg);
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
}

function parseOpenAiStyleErrorBody(raw: string, status: number): string {
  if (!raw.trim()) return `HTTP ${status} (empty body)`;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const errObj = j.error as Record<string, unknown> | string | undefined;
    if (typeof errObj === 'string') return errObj;
    if (errObj && typeof errObj === 'object') {
      const m = errObj.message;
      if (typeof m === 'string') return m;
    }
    const direct =
      (typeof j.message === 'string' && j.message) ||
      (typeof j.msg === 'string' && j.msg) ||
      (typeof j.detail === 'string' && j.detail);
    if (direct) return direct;
  } catch {
    /* not JSON */
  }
  return raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
}

function extractChatCompletionContent(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = d?.choices?.[0]?.message?.content;
  if (content == null || content === '') {
    logger.error('ai', 'unexpected response (no choices[0].message.content)', data);
    throw new AppError('ai.no_text');
  }
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => {
        if (typeof c === 'object' && c !== null && 'text' in c) {
          const t = (c as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join('');
  }
  return String(content);
}

/** Parse `data:image/...;base64,...` for multimodal APIs. */
export function parseImageDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const trimmed = dataUrl.trim();
  const m = /^data:(image\/[a-zA-Z0-9+.^-]+);base64,(.+)$/s.exec(trimmed);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function buildOpenAiUserContent(
  prompt: string,
  images: string[] | undefined,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!images?.length) return prompt;
  const content: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];
  for (const url of images) {
    if (parseImageDataUrl(url)) content.push({ type: 'image_url', image_url: { url } });
  }
  return content;
}

type AnthropicUserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function buildAnthropicUserContent(
  prompt: string,
  images: string[] | undefined,
): string | AnthropicUserBlock[] {
  if (!images?.length) return prompt;
  const blocks: AnthropicUserBlock[] = [{ type: 'text', text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType, data: p.base64 },
      });
    }
  }
  return blocks;
}

/**
 * 拼出 Anthropic Messages 的完整地址。
 *
 * 两种写法都要收：我们的预设存的是含 `/v1` 的完整前缀，而 Claude Code 生态
 * （cc-switch、各种中转站）里的 `ANTHROPIC_BASE_URL` 存的是站点根，`/v1` 由
 * 客户端补。判断放在这一处，导入配置时就不用猜着改用户填的地址。
 */
export function anthropicMessagesUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '') || ANTHROPIC_BASE_URL;
  return /\/v\d+$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function buildGeminiUserPayload(
  prompt: string,
  images: string[] | undefined,
): string | GeminiPart[] {
  if (!images?.length) return prompt;
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) parts.push({ inlineData: { mimeType: p.mediaType, data: p.base64 } });
  }
  return parts;
}

async function postOpenAiCompatibleChat(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string }
): Promise<string> {
  const key = apiKey.trim();
  if (!key) {
    throw new AppError('ai.no_api_key');
  }
  logger.info('ai', 'chat/completions request', {
    provider: meta.provider,
    model: meta.model,
    url,
    runtime: isTauriRuntime() ? 'tauri' : 'web',
    apiKey: maskApiKeyForLog(key),
  });

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const text = await invoke<string>('openai_compatible_chat', { apiKey: key, url, body });
      return text;
    } catch (e) {
      const msg = formatAiError(e);
      logger.error('ai', 'Tauri invoke openai_compatible_chat failed', msg);
      // Rust 侧把 HTTP 错误体原样抛回来；自家守卫错误（insecure_url / response_too_large）单独认码
      throw appErrorFromProxyFailure(msg);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    logger.error('ai', 'network/fetch failed', { url, error: formatAiError(e) });
    throw new AppError('ai.network', formatAiError(e));
  }

  const rawText = await response.text();
  if (!response.ok) {
    const msg = parseOpenAiStyleErrorBody(rawText, response.status);
    logger.error('ai', 'chat/completions HTTP error', {
      status: response.status,
      url,
      bodyPreview: rawText.slice(0, 2000),
    });
    throw new AppError('ai.http', msg);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    logger.error('ai', 'invalid JSON response', rawText.slice(0, 2000));
    throw new AppError('ai.bad_response');
  }
  return extractChatCompletionContent(data);
}

/** Accumulate OpenAI-style SSE (`data: {...}\\n`) deltas from a fetch Response body. */
async function consumeOpenAiSseFromResponse(
  response: Response,
  onAccumulated: (full: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const rawText = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new AppError('ai.bad_response');
    }
    const content = extractChatCompletionContent(data);
    onAccumulated(content);
    return content;
  }

  const decoder = new TextDecoder();
  let carry = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataLine = trimmed.slice(5).trimStart();
      if (dataLine === '[DONE]') continue;
      try {
        const json = JSON.parse(dataLine) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const piece = json?.choices?.[0]?.delta?.content ?? '';
        if (piece) {
          full += piece;
          onAccumulated(full);
        }
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  return full;
}

async function postOpenAiCompatibleChatWithOptionalStream(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string },
  onStreamChunk?: (accumulated: string) => void,
): Promise<string> {
  if (!onStreamChunk) {
    return postOpenAiCompatibleChat(apiKey, url, body, meta);
  }

  const streamBody = { ...body, stream: true };

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const streamId = crypto.randomUUID();
    const unlisten = await listen<{ id: string; text: string }>('lab-ai-stream', (event) => {
      if (event.payload.id !== streamId) return;
      onStreamChunk(event.payload.text);
    });
    try {
      return await invoke<string>('openai_compatible_chat_stream', {
        apiKey: apiKey.trim(),
        url,
        body: streamBody,
        streamId,
      });
    } catch (e) {
      // 与非流式那条路一致地包成 AppError：调用方要按 code + detail 判断
      // 能不能重试（例如模型拒收采样参数），裸字符串在这里就断链了。
      const msg = formatAiError(e);
      logger.error('ai', 'Tauri invoke openai_compatible_chat_stream failed', msg);
      throw appErrorFromProxyFailure(msg);
    } finally {
      unlisten();
    }
  }

  const key = apiKey.trim();
  if (!key) {
    throw new AppError('ai.no_api_key');
  }
  logger.info('ai', 'chat/completions stream', {
    provider: meta.provider,
    model: meta.model,
    url,
    runtime: 'web',
    apiKey: maskApiKeyForLog(key),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(streamBody),
    });
  } catch (e) {
    logger.error('ai', 'stream network/fetch failed', { url, error: formatAiError(e) });
    throw new AppError('ai.network', formatAiError(e));
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new AppError('ai.http', parseOpenAiStyleErrorBody(errBody, response.status));
  }

  const full = await consumeOpenAiSseFromResponse(response, onStreamChunk);
  if (!full.trim()) {
    throw new AppError('ai.no_text');
  }
  return full;
}

export type CallAIFn = (params: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  /** `data:image/*;base64,...` URLs from canvas image nodes */
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
}) => Promise<string>;

export type AiProviderConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  localGgufPath?: string;
  localEnableThinking?: boolean;
  /** 本地推理手动覆盖；undefined = 自动（由规划器按硬件现算）。 */
  localNGpuLayers?: number;
  localNCtx?: number;
  localNThreads?: number;
  localMaxTokens?: number;
  /** undefined = 默认 15 分钟；null = 会话期常驻；0 = 用后即退。 */
  localKeepAliveMinutes?: number | null;
};

// ───────────────────────── 本地模型（llama-server 常驻子进程） ─────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** hardware_probe 打不通时的保守兜底：纯 CPU、4 线程、按 8GB 机器的可用量估。 */
const FALLBACK_HARDWARE: HardwareInfo = {
  totalRamBytes: 8 * 1024 ** 3,
  availableRamBytes: 4 * 1024 ** 3,
  physicalCores: 4,
  logicalCores: 8,
  gpus: [],
  platform: 'unknown',
  unifiedMemory: false,
};

/**
 * 解析本次本地推理的运行参数：GGUF 元数据 + 硬件探测 → 规划器，手动覆盖直接生效。
 *
 * GGUF 读不动（选错文件/文件没了/版本不支持）当场报，不再等子进程失败翻日志；
 * 硬件探测失败则退回保守默认值——探测挂了不该把整条本地推理路都堵死。
 */
async function resolveLocalRunParams(
  invoke: InvokeFn,
  config: AiProviderConfig,
  modelPath: string,
): Promise<LocalRunPlan> {
  let gguf: GgufInfo;
  try {
    gguf = await invoke<GgufInfo>('gguf_inspect', { path: modelPath });
  } catch (e) {
    throw new AppError('ai.local_gguf_invalid', formatAiError(e));
  }

  let hardware: HardwareInfo;
  try {
    hardware = await invoke<HardwareInfo>('hardware_probe', {});
  } catch (e) {
    logger.warn('ai', 'hardware_probe failed, using conservative CPU fallback', formatAiError(e));
    hardware = FALLBACK_HARDWARE;
  }

  // 实际引擎后端约束规划：CPU 引擎不给任何卡 offload，CUDA 引擎只认 NVIDIA。
  // 查不到状态（老引擎/异常）按硬件乐观规划——server 侧对无效 -ngl 会自行忽略。
  let engineBackend: 'cpu' | 'cuda' | 'metal' | null = null;
  try {
    const status = await invoke<{ backend?: 'cpu' | 'cuda' | 'metal' | null }>(
      'local_engine_status',
      {},
    );
    engineBackend = status.backend ?? null;
  } catch {
    /* 状态查询失败不拦路 */
  }

  return planLocalRun(
    gguf,
    hardware,
    {
      nGpuLayers: config.localNGpuLayers,
      nCtx: config.localNCtx,
      nThreads: config.localNThreads,
      maxTokens: config.localMaxTokens,
    },
    { engineBackend },
  );
}

/**
 * 本地 GGUF 对话：确保 llama-server 起着 → 走它的 OpenAI 兼容接口。
 *
 * 流式、多轮消息、错误映射全部复用 openai 分支的现成通道
 * （`postOpenAiCompatibleChatWithOptionalStream`，127.0.0.1 在 http 白名单里）。
 * `enable_thinking` 经 `chat_template_kwargs` 传给 chat template——旧架构里
 * 这个开关 UI 有、后端从不读，在这里复活。
 */
async function callLocalLlama({
  config,
  prompt,
  systemInstruction,
  temperature,
  topP,
  onStreamChunk,
}: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature: number;
  topP: number;
  onStreamChunk?: (accumulatedText: string) => void;
}): Promise<string> {
  const modelPath = (config.localGgufPath ?? '').trim();
  const { invoke } = await import('@tauri-apps/api/core');
  const typedInvoke: InvokeFn = (cmd, args) => invoke(cmd, args);

  const plan = await resolveLocalRunParams(typedInvoke, config, modelPath);

  const keepAlive = config.localKeepAliveMinutes;
  const ensureArgs = (nGpuLayers: number): Record<string, unknown> => ({
    modelPath,
    nGpuLayers,
    nCtx: plan.nCtx,
    nThreads: plan.nThreads,
    // null（会话期常驻）以 -1 下发；undefined 不传，由 Rust 用默认 15 分钟
    ...(keepAlive === undefined ? {} : { keepAliveMinutes: keepAlive === null ? -1 : keepAlive }),
  });

  logger.info('ai', 'local llama-server ensure', {
    modelPath: modelPath.slice(0, 80) + (modelPath.length > 80 ? '…' : ''),
    ...plan,
  });

  let ensured: { port: number; restarted: boolean };
  try {
    ensured = await invoke<{ port: number; restarted: boolean }>(
      'local_server_ensure',
      ensureArgs(plan.nGpuLayers),
    );
  } catch (e) {
    const msg = formatAiError(e);
    // 显存不够：按实际情况降 25% 层数再试一次；仍失败就原样报
    if (!(msg === 'oom' || msg.startsWith('oom')) || plan.nGpuLayers <= 0) {
      throw new AppError('ai.local_failed', msg);
    }
    const reduced = Math.floor(plan.nGpuLayers * 0.75);
    logger.warn('ai', 'local server OOM, retrying with fewer GPU layers', {
      from: plan.nGpuLayers,
      to: reduced,
    });
    try {
      ensured = await invoke<{ port: number; restarted: boolean }>(
        'local_server_ensure',
        ensureArgs(reduced),
      );
    } catch (e2) {
      throw new AppError('ai.local_failed', formatAiError(e2));
    }
  }

  const url = `http://127.0.0.1:${ensured.port}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    model: 'local',
    messages: [
      ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
      { role: 'user' as const, content: prompt },
    ],
    temperature,
    top_p: topP,
    max_tokens: plan.maxTokens,
    chat_template_kwargs: { enable_thinking: config.localEnableThinking ?? false },
  };

  try {
    await invoke('local_server_touch');
  } catch {
    /* touch 失败不拦对话 */
  }
  try {
    return await postOpenAiCompatibleChatWithOptionalStream(
      'local',
      url,
      body,
      { provider: 'local_llama', model: modelPath },
      onStreamChunk,
    );
  } finally {
    try {
      await invoke('local_server_touch');
    } catch {
      /* ignore */
    }
    if (keepAlive === 0) {
      // 用后即退：对话一结束立刻卸载，内存/显存马上归还
      try {
        await invoke('local_server_stop');
      } catch {
        /* ignore */
      }
    }
  }
}

export async function callUniversalAI({
  config,
  prompt,
  systemInstruction,
  temperature = 0.7,
  topP = 0.4,
  images,
  onStreamChunk,
}: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
}): Promise<string> {
  const apiKeyTrimmed = (config.apiKey ?? '').trim();
  const useUserConfig = Boolean(apiKeyTrimmed);

  if (config.provider === 'local_llama') {
    if (images?.length) {
      throw new AppError('ai.local_no_images');
    }
    if (!isTauriRuntime()) {
      throw new AppError('ai.local_desktop_only');
    }
    if (!(config.localGgufPath ?? '').trim()) {
      throw new AppError('ai.local_no_path');
    }
    return callLocalLlama({ config, prompt, systemInstruction, temperature, topP, onStreamChunk });
  }

  if (config.provider === 'gemini') {
    if (!apiKeyTrimmed) throw new AppError('ai.no_api_key');
    const apiKey = apiKeyTrimmed;

    logger.info('ai', 'Gemini generateContent', {
      model: config.model,
      apiKey: maskApiKeyForLog(apiKey),
    });

    const ai = new GoogleGenAI({ apiKey });
    const modelId = config.model;

    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: buildGeminiUserPayload(prompt, images),
        config: {
          systemInstruction,
          temperature,
          topP
        }
      });
      const text = response.text || '';
      onStreamChunk?.(text);
      return text;
    } catch (e) {
      logger.error('ai', 'Gemini failed', formatAiError(e));
      throw e instanceof Error ? e : new Error(formatAiError(e));
    }
  }

  if (!useUserConfig) {
    throw new AppError('ai.no_api_key');
  }

  if (
    config.provider === 'openai' ||
    config.provider === 'custom' ||
    config.provider === 'mimo' ||
    config.provider === 'deepseek' ||
    config.provider === 'doubao'
  ) {
    const baseNormalized = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const mimoBase = (config.baseUrl || MIMO_TOKEN_PLAN_BASE_URL).replace(/\/$/, '');
    const deepseekBase = (config.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');
    const doubaoBase = (config.baseUrl || DOUBAO_ARK_BASE_URL).replace(/\/$/, '');
    const chatUrl =
      config.provider === 'mimo'
        ? (isTauriRuntime() ? `${mimoBase}/chat/completions` : '/api/mimo/chat/completions')
        : config.provider === 'deepseek'
          ? (isTauriRuntime() ? `${deepseekBase}/chat/completions` : '/api/deepseek/chat/completions')
          : config.provider === 'doubao'
            ? (isTauriRuntime() ? `${doubaoBase}/chat/completions` : '/api/doubao/chat/completions')
            : `${baseNormalized}/chat/completions`;

    // 豆包（火山方舟）没有通用默认值：`model` 要的是账号自己的推理接入点 ID。
    const fallbackModel =
      config.provider === 'mimo'
        ? 'mimo-v2.5-pro'
        : config.provider === 'deepseek'
          ? DEEPSEEK_DEFAULT_MODEL
          : config.provider === 'doubao'
            ? ''
            : 'gpt-4o';
    const model = (config.model ?? '').trim() || fallbackModel;
    if (!model) {
      throw new AppError(
        config.provider === 'doubao' ? 'ai.doubao_needs_endpoint' : 'ai.no_model',
      );
    }
    const buildBody = (withSampling: boolean) => ({
      model,
      messages: [
        ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
        { role: 'user' as const, content: buildOpenAiUserContent(prompt, images) }
      ],
      ...(withSampling ? { temperature, top_p: topP } : {}),
    });

    const meta = { provider: config.provider, model };
    const knownFixed = modelRejectsSampling(model);

    try {
      return await postOpenAiCompatibleChatWithOptionalStream(
        apiKeyTrimmed, chatUrl, buildBody(!knownFixed), meta, onStreamChunk,
      );
    } catch (e) {
      // 已经不带采样参数了还失败，那就不是采样参数的问题，原样抛。
      // 否则：报错点名了 temperature/top_p 就去掉重试一次——名单永远追不上
      // 新模型，让用户卡在一条看不懂的 400 上比多花一个来回糟糕得多。
      const retryable =
        !knownFixed && isAppError(e) && e.code === 'ai.http' && looksLikeSamplingRejection(e.detail);
      if (!retryable) throw e;
      logger.warn('ai', 'model rejected sampling params, retrying without them', {
        model,
        detail: e.detail?.slice(0, 200),
      });
      return await postOpenAiCompatibleChatWithOptionalStream(
        apiKeyTrimmed, chatUrl, buildBody(false), meta, onStreamChunk,
      );
    }
  }

  if (config.provider === 'anthropic') {
    const model = config.model || 'claude-3-5-sonnet-20240620';
    const url = anthropicMessagesUrl(config.baseUrl);
    logger.info('ai', 'Anthropic messages', {
      model,
      url,
      runtime: isTauriRuntime() ? 'tauri' : 'web',
      apiKey: maskApiKeyForLog(apiKeyTrimmed),
    });
    const requestBody = {
      model,
      system: systemInstruction,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildAnthropicUserContent(prompt, images) }],
      temperature
    };

    let rawText: string;
    if (isTauriRuntime()) {
      // 走 Rust。api.anthropic.com 不发 CORS 头，webview 里直接 fetch 只会拿到
      // 一条没有任何信息的 "Failed to fetch"——连状态码都看不到。
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        rawText = await invoke<string>('anthropic_messages', {
          apiKey: apiKeyTrimmed,
          url,
          body: requestBody,
        });
      } catch (e) {
        const msg = formatAiError(e);
        logger.error('ai', 'Tauri invoke anthropic_messages failed', msg);
        throw appErrorFromProxyFailure(msg);
      }
    } else {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKeyTrimmed,
            'anthropic-version': '2023-06-01',
            // 浏览器里直连必须显式开这个，官方才会回 CORS 头
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(requestBody)
        });
      } catch (e) {
        logger.error('ai', 'Anthropic network/fetch failed', { url, error: formatAiError(e) });
        throw new AppError('ai.network', formatAiError(e));
      }

      rawText = await response.text();
      if (!response.ok) {
        const msg = parseOpenAiStyleErrorBody(rawText, response.status);
        logger.error('ai', 'Anthropic HTTP error', response.status, rawText.slice(0, 2000));
        throw new AppError('ai.http', msg);
      }
    }

    let data: { content?: unknown };
    try {
      data = JSON.parse(rawText);
    } catch {
      logger.error('ai', 'invalid Anthropic JSON response', rawText.slice(0, 2000));
      throw new AppError('ai.bad_response');
    }
    const blocks = data.content as Array<{ type?: string; text?: string }>;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      logger.error('ai', 'unexpected Anthropic response', data);
      throw new AppError('ai.bad_response');
    }
    const text = blocks
      .map((b) => {
        if (typeof b.text !== 'string') return '';
        if (b.type === 'image') return '';
        return b.text;
      })
      .join('');
    if (!text) {
      logger.error('ai', 'Anthropic returned no text blocks', data);
      throw new AppError('ai.no_text');
    }
    onStreamChunk?.(text);
    return text;
  }

  throw new AppError('ai.provider_unsupported', config.provider);
}
