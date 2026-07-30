/**
 * 底部输入栏：这句话值不值得先跑一轮「建节点」规划。
 *
 * 规划是一次额外的模型调用。以前这个输入栏只干一件事——生成一张 AI 卡，
 * 现在还要能听懂「建三个便签」，但不该为「帮我解释一下量子纠缠」也多花一次调用。
 *
 * 这里只做**粗筛**：动词 + 名词同时命中才放行。判错的方向是有意选的——
 * - 误放行（「主题卡怎么建？」）由规划器兜底，它会回 `answer`，只是多花一次调用；
 * - 误拦截则是功能直接不生效，所以名词表宁可宽一点。
 */

/** 画布上能被「建」出来的东西。中文无词界，直接子串匹配。 */
const CJK_NODE_NOUNS = ['便签', '便利贴', '笔记', '主题卡', '卡片', '节点'];

/** 与创建/改写沾边的动词。单字词（建/加/写）靠名词共现来压误判。 */
const CJK_CREATE_VERBS = [
  '创建', '新建', '建', '添加', '加', '生成', '做', '整理', '拆', '写', '分', '列', '转', '变', '来',
];

const EN_NODE_NOUNS = /\b(notes?|stick(?:y|ies)|cards?|nodes?)\b/i;
const EN_CREATE_VERBS = /\b(creat(?:e|ing)|add|adding|make|making|new|generat(?:e|ing)|draft|split|turn|write|jot)\b/i;

export function looksLikeCanvasNodeRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  const hasCjkNoun = CJK_NODE_NOUNS.some((n) => t.includes(n));
  if (hasCjkNoun && CJK_CREATE_VERBS.some((v) => t.includes(v))) return true;

  return EN_NODE_NOUNS.test(t) && EN_CREATE_VERBS.test(t);
}
