/**
 * Volcengine Ark (火山方舟) OpenAI-compatible API for Doubao models.
 * Chat endpoint: {DOUBAO_ARK_BASE_URL}/chat/completions
 */
export const DOUBAO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * 火山方舟没有可以预填的默认模型名。
 *
 * `chat/completions` 的 `model` 字段要的是用户自己控制台里的「推理接入点」ID（`ep-` 开头），
 * 与账号绑定；写死任何一个都只对某一个账号有效，别人拿自己的 Key 打它必然报错。
 * 因此留空，由用户在设置里填写。
 */
export const DOUBAO_DEFAULT_MODEL = '';
