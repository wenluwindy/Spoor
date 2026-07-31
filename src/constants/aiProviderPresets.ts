import type { ImageApiKind, ImageModelEntry, ProviderKind } from '../types/aiConfig';
import { DOUBAO_ARK_BASE_URL } from './doubao';
import { DEEPSEEK_BASE_URL } from './deepseek';
import { MIMO_TOKEN_PLAN_BASE_URL } from './mimo';

/**
 * 服务商预设：Base URL、生图协议、默认生图模型。
 *
 * 只是**一键填充的模板**，填进去之后每一项用户都能改——包括 Base URL 和模型名。
 * 预设里不含任何 API Key。
 */

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
/** RightAPI 的**绘图**基址。注意是 rightapi.ai，不是 right.ai（另一家的站点）。 */
export const RIGHTAPI_DRAW_BASE_URL = 'https://www.rightapi.ai/draw/v1';

/** 各服务商的默认 Base URL。`custom` 没有默认值，必须用户填。 */
export const PROVIDER_DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  doubao: DOUBAO_ARK_BASE_URL,
  openai: OPENAI_BASE_URL,
  gemini: GEMINI_BASE_URL,
  anthropic: ANTHROPIC_BASE_URL,
  deepseek: DEEPSEEK_BASE_URL,
  mimo: MIMO_TOKEN_PLAN_BASE_URL,
  custom: '',
  local_llama: '',
};

/**
 * 由服务商类型推导生图协议。
 *
 * 返回 `undefined` 表示该服务商没有生图能力（DeepSeek/MiMo/Anthropic/本地 GGUF）；
 * `custom` 默认按 OpenAI 兼容处理，用户可在设置里改。
 */
export function defaultImageApiKind(kind: ProviderKind): ImageApiKind | undefined {
  switch (kind) {
    case 'doubao':
      return 'doubao_seedream';
    case 'openai':
      return 'openai_images';
    case 'gemini':
      return 'gemini_image';
    case 'custom':
      return 'custom_openai_images';
    default:
      return undefined;
  }
}

/** 该服务商是否可能提供生图。用于设置面板决定要不要显示「生图模型」区块。 */
export function supportsImageGeneration(kind: ProviderKind): boolean {
  return defaultImageApiKind(kind) !== undefined;
}

/**
 * `custom` 服务商可选的生图协议。
 *
 * 只有自定义端点需要选——其余几种由 `kind` 唯一确定，摆出来只会让人选错。
 */
export const SELECTABLE_IMAGE_API_KINDS: ImageApiKind[] = [
  'custom_openai_images',
  'rightapi_draw',
  'doubao_seedream',
  'gemini_image',
];

type PresetImageModel = Omit<ImageModelEntry, 'id'>;

/**
 * 各家的默认生图模型。模型 ID 会变，这里只是开箱可用的起点，用户可改可删可加。
 *
 * `maxRefImages` 按各家文档给：Seedream 4.0 支持多图数组，gpt-image-1 的
 * `/images/edits` 收 `image[]`，Gemini 在 parts 里追加 inlineData。
 */
export const PRESET_IMAGE_MODELS: Partial<Record<ProviderKind, PresetImageModel[]>> = {
  doubao: [
    {
      modelName: 'doubao-seedream-4-0-250828',
      label: 'Seedream 4.0',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
      sizeOptions: ['1024x1024', '2048x2048', '2048x1152', '1152x2048'],
      defaultParams: { size: '2048x2048', n: 1 },
    },
  ],
  openai: [
    {
      modelName: 'gpt-image-1',
      label: 'GPT Image 1',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
      sizeOptions: ['1024x1024', '1536x1024', '1024x1536'],
      defaultParams: { size: '1024x1024', n: 1, quality: 'high' },
    },
  ],
  gemini: [
    {
      modelName: 'gemini-2.5-flash-image',
      label: 'Nano Banana (Flash)',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 3 },
      defaultParams: { n: 1 },
    },
    {
      modelName: 'gemini-3-pro-image-preview',
      label: 'Nano Banana Pro',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 3 },
      defaultParams: { n: 1 },
    },
  ],
};

/**
 * 按生图协议给的预设，用于 `custom` 服务商——它的 `kind` 一律是 `custom`，
 * 靠 [`PRESET_IMAGE_MODELS`] 那张按 `ProviderKind` 索引的表区分不开。
 *
 * RightAPI 的 `size` 是**宽高比**而不是像素（`1:1` / `16:9` / `9:16` / `4:3`），
 * 缺省时服务端按 1024x1024 出图。`quality` 会被发成它的 `imageSize`（`1K`/`2K`/`4K`），
 * 只有部分模型支持，所以预设里不填。
 */
export const PRESET_IMAGE_MODELS_BY_API_KIND: Partial<Record<ImageApiKind, PresetImageModel[]>> = {
  rightapi_draw: [
    {
      modelName: 'nano-banana-fast',
      label: 'Nano Banana Fast (RightAPI)',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
      sizeOptions: ['1:1', '16:9', '9:16', '4:3'],
      defaultParams: { size: '1:1', n: 1 },
    },
    {
      modelName: 'nano-banana',
      label: 'Nano Banana (RightAPI)',
      capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
      sizeOptions: ['1:1', '16:9', '9:16', '4:3'],
      defaultParams: { size: '1:1', n: 1 },
    },
  ],
};

/** 各家默认对话模型。火山方舟刻意留空——它要的是账号下的推理接入点 ID。 */
export const PRESET_CHAT_MODEL: Partial<Record<ProviderKind, { modelName: string; label: string }>> = {
  openai: { modelName: 'gpt-4o', label: 'GPT-4o' },
  gemini: { modelName: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  anthropic: { modelName: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  deepseek: { modelName: 'deepseek-chat', label: 'DeepSeek Chat' },
  mimo: { modelName: 'mimo-7b-rl', label: 'MiMo' },
};
