/**
 * 模型服务配置 v2。
 *
 * v1 是一份扁平配置：一个服务商 + 一个 Key + 一个模型。生图要求「一个 API 和链接
 * 可以挂多个生图模型」，且生图与对话配置合并，扁平结构装不下，于是改成
 * 「服务商列表 + 每个服务商下挂对话模型与生图模型」。
 *
 * 调用方（`services/ai`、`ResearchLab`、`AgentsStudio`）**不动**：
 * `services/aiConfig.resolveActiveChatConfig` 把 v2 压回 v1 的扁平形状喂给它们，
 * 把爆炸半径限制在这一层。
 */

export type ProviderKind =
  | 'doubao'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'deepseek'
  | 'mimo'
  | 'custom'
  | 'local_llama';

/**
 * 生图请求/响应的协议族。默认由 `ProviderKind` 推导，`custom` 可在设置里改。
 *
 * `rightapi_draw` 是异步协议：提交只拿到 `task_id`，要轮询任务才有图，
 * 跟其余几种一发一收的同步协议不通用。
 */
export type ImageApiKind =
  | 'doubao_seedream'
  | 'openai_images'
  | 'gemini_image'
  | 'custom_openai_images'
  | 'rightapi_draw';

export interface AIModelEntry {
  /** 配置内唯一 id，与服务商无关，改模型名不影响引用它的节点。 */
  id: string;
  /** 发给服务商的模型标识。火山方舟填的是推理接入点 ID（`ep-…`）而非模型名。 */
  modelName: string;
  /** 界面上显示的名字。留空时退回 `modelName`。 */
  label: string;
}

export interface ImageModelCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  /** 支持的参考图张数上限；0 表示不支持图生图。 */
  maxRefImages: number;
}

export interface ImageModelEntry extends AIModelEntry {
  capabilities: ImageModelCapabilities;
  sizeOptions?: string[];
  defaultParams?: { size?: string; n?: number; quality?: string };
}

export interface AIProviderProfile {
  id: string;
  /** 用户可改的显示名（「火山方舟」「公司内网」）。 */
  name: string;
  kind: ProviderKind;
  /** 用户自填，无内置回退——内置 Key 会被从安装包里扒出来。 */
  apiKey: string;
  baseUrl: string;
  chatModels: AIModelEntry[];
  imageModels: ImageModelEntry[];
  imageApiKind?: ImageApiKind;
  /** `kind === 'local_llama'` 时的 GGUF 绝对路径。 */
  localGgufPath?: string;
  localEnableThinking?: boolean;
}

/**
 * 联网搜索服务。不是模型服务商，所以不进 `ProviderKind`——它没有模型、
 * 不参与对话与生图的解析链路，只在需要网页上下文时被调一次。
 */
export type SearchProviderKind = 'metaso' | 'tavily';

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface AIConfigV2 {
  version: 2;
  providers: AIProviderProfile[];
  /** 对话默认用哪个模型。指向已删除的服务商时由 resolve 层兜底。 */
  activeChat: ModelRef;
  /** 生图默认用哪个模型；生图节点可各自覆盖。 */
  defaultImage?: ModelRef;
  /**
   * @deprecated 已并入 `searchApiKeys.metaso`，`normalizeAiConfig` 负责迁移。
   * 字段保留是为了老配置读出来不丢 Key。
   */
  metasoApiKey?: string;
  /** 当前启用哪家搜索服务。缺省 `metaso`。 */
  searchProvider?: SearchProviderKind;
  /** 各家各存各的 Key，切换服务不丢已填的。 */
  searchApiKeys?: Partial<Record<SearchProviderKind, string>>;
}
