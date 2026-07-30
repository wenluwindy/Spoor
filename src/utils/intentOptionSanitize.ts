/** 模型误把「给助手的操作」当成选项时，视为无效澄清。 */
const ASSISTANT_DIRECTED_ZH =
  /^(安慰|询问|帮助|引导|建议用户|为用户|向用户|了解用户|回应用户|写一?篇|撰写|提供.{0,8}建议)/;

const ASSISTANT_DIRECTED_EN =
  /^(comfort|ask the user|help the user|guide the user|provide.{0,20}advice|write (a |an )?)/i;

/** 误把「替用户表态」的第一人称改写当成选项。 */
const USER_REWRITE_ZH = /^我(很|想|最近|主要|因为|有一)/;
const USER_REWRITE_EN = /^(I am|I want|I need|I'm|I feel)/i;

export function intentOptionLooksAssistantDirected(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  return ASSISTANT_DIRECTED_ZH.test(s) || ASSISTANT_DIRECTED_EN.test(s);
}

export function intentOptionLooksUserRewrite(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  return USER_REWRITE_ZH.test(s) || USER_REWRITE_EN.test(s);
}

export function intentOptionLooksInvalidClarification(text: string): boolean {
  return intentOptionLooksAssistantDirected(text) || intentOptionLooksUserRewrite(text);
}

/** 至少两条无效则整组澄清作废，改走用户原话。 */
export function intentOptionsAreInvalidClarification(options: string[]): boolean {
  const hits = options.filter(intentOptionLooksInvalidClarification);
  return hits.length >= 2;
}
