/**
 * 哪些模型不接受采样参数。
 *
 * 一部分模型把 `temperature` / `top_p` 写死了，传别的值不是被忽略，而是直接 400：
 * Moonshot 的 Kimi K2.5/K2.6 报 `invalid temperature: only 1 is allowed for this model`，
 * OpenAI 的 o 系列与 GPT-5 系列报 `Unsupported value: 'temperature'`。
 *
 * 名单不可能追全——各家几乎每个月都出新模型。所以这里只做**先验**，
 * 真正兜底的是 `looksLikeSamplingRejection`：报错里点名了采样参数就去掉重试一次。
 * 两层一起用，新模型第一次调用会多花一个来回，但不会失败。
 */

const FIXED_SAMPLING_PATTERNS: RegExp[] = [
  // Kimi K2.5 起的思考型模型；K2/K1.5 仍然接受采样参数，所以不能整族匹配
  /^kimi-k2\.[5-9]/i,
  /^kimi-k[3-9]/i,
  /^kimi-.*thinking/i,
  // OpenAI 推理系列：o1 / o1-mini / o3 / o3-pro / o4-mini
  /^o[1-9](-|$)/i,
  // GPT-5 全族
  /^gpt-5/i,
];

export function modelRejectsSampling(modelName: string): boolean {
  const name = modelName.trim();
  if (!name) return false;
  // 网关常把模型名写成 `供应商/模型` 或 `账号:模型`，取最后一段再比
  const bare = name.split(/[/:]/).pop() ?? name;
  return FIXED_SAMPLING_PATTERNS.some((re) => re.test(bare));
}

/**
 * 这条报错是不是在骂采样参数。
 *
 * 判据刻意宽松：错误体里出现 `temperature` / `top_p` 基本只有这一种可能，
 * 而漏判的代价是用户看到一条看不懂的 400 并以为是密钥填错了。
 */
export function looksLikeSamplingRejection(detail: string | undefined): boolean {
  if (!detail) return false;
  return /temperature|top[_-]?p/i.test(detail);
}
