import { callUniversalAI, formatAiError, isTauriRuntime } from './ai';
import { AppError } from './appError';
import type { GgufInfo } from './localModelPlanner';
import type { AIProviderProfile } from '../types/aiConfig';

/**
 * 连通性测试：拿这个服务商/模型真发一次最小请求。
 *
 * 比起「保存了但不知道对不对」，让用户当场看到成功或失败的原因要有用得多——
 * Key 填错、Base URL 少了 `/v1`、豆包填了模型名而不是接入点 ID，
 * 这些错误只有真发一次才暴露得出来。
 */

export type ConnectivityResult =
  | { ok: true; sample: string }
  | { ok: false; error: unknown };

/** 提示词刻意极短，测试花的 token 越少越好。 */
const PING_PROMPT = 'ping';

/**
 * 不钉 `temperature` / `top_p`。
 *
 * 原先钉了 `temperature: 0` 求省钱又确定，结果 Kimi K2.5 这类把采样参数写死的
 * 模型直接 400：`invalid temperature: only 1 is allowed for this model`——
 * 明明密钥和地址都对，测试却报「连接失败」。连通性测试要验的是「能不能通」，
 * 一个 ping 的随机性无关紧要，交给服务商的默认值就好。
 */

export async function testChatModel(
  provider: AIProviderProfile,
  modelName: string,
): Promise<ConnectivityResult> {
  if (provider.kind === 'local_llama') {
    return testLocalModel(provider);
  }
  try {
    const text = await callUniversalAI({
      config: {
        provider: provider.kind,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: modelName,
        localGgufPath: provider.localGgufPath,
        localEnableThinking: provider.localEnableThinking,
      },
      prompt: PING_PROMPT,
    });
    return { ok: true, sample: (text ?? '').trim().slice(0, 120) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 本地模型不真跑一轮推理（旧实现一次 ping 就是 5–10 秒起步）。
 * 「能通」在这里等价于：推理引擎装着 + GGUF 文件读得动——两者都是毫秒级检查，
 * 真正的加载与生成留给第一次对话。
 */
async function testLocalModel(provider: AIProviderProfile): Promise<ConnectivityResult> {
  try {
    if (!isTauriRuntime()) {
      throw new AppError('ai.local_desktop_only');
    }
    const path = (provider.localGgufPath ?? '').trim();
    if (!path) {
      throw new AppError('ai.local_no_path');
    }
    const { invoke } = await import('@tauri-apps/api/core');

    const status = await invoke<{ installed: boolean }>('local_engine_status');
    if (!status.installed) {
      throw new AppError('ai.local_engine_missing');
    }

    let info: GgufInfo;
    try {
      info = await invoke<GgufInfo>('gguf_inspect', { path });
    } catch (e) {
      throw new AppError('ai.local_gguf_invalid', formatAiError(e));
    }

    const sample = [info.modelName, info.sizeLabel, info.quantLabel]
      .filter((v): v is string => Boolean(v))
      .join(' · ');
    return { ok: true, sample };
  } catch (error) {
    return { ok: false, error };
  }
}
