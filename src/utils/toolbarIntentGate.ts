/** 短句：超过此长度（含中英文一字一算）则默认不跑意图预检（除非命中问号/多指令） */
export const TOOLBAR_INTENT_SHORT_MAX_CHARS = 40;

/**
 * 仅当可能「短句 / 带问 / 多指令」时，才对底部工具栏输入跑一层意图歧义预检。
 * 返回 false 时，用户原文将直接进入主生成模型。
 */
export function shouldPreflightToolbarIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (t.includes('?') || t.includes('？')) return true;

  if (t.length <= TOOLBAR_INTENT_SHORT_MAX_CHARS) return true;

  const semicolonParts = t.split(/[；;]/).filter((s) => s.trim().length > 0);
  if (semicolonParts.length >= 2) return true;

  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return true;

  const numbered = t.match(/(?:^|\n)\s*\d+[\.、]\s*[^\n]+/g);
  if (numbered && numbered.length >= 2) return true;

  return false;
}
