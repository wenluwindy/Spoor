/**
 * 悬停提示守卫。
 *
 * 只盯**纯图标控件**：按钮里没有任何可见文字，用户看不出它是干什么的，必须有悬停提示。
 * 带可见文字的按钮、表单 `<label>` 不在范围内——给它们加提示只是噪音。
 *
 * 提示一律走 `src/components/ui/Tooltip.tsx`（原生 `title` 延迟约 1s、样式不可控），
 * Tooltip 会给子元素写上 `aria-label`，因此这里认 `<Tooltip>` 包裹或显式 `aria-label`。
 *
 * 用法：`node scripts/audit-tooltips.mjs`，有缺口则退出码 1。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';

/**
 * 明确不需要提示的位置：`file:line`。
 *
 * 只登记启发式判不出、但人一眼能看出有可见文字的位置，别用它掩盖真缺口。
 */
const EXEMPT = new Set([
  // 研究历史条目：按钮里显示的是 {session.query}（用户自己输入的研究主题）
  'src/components/ResearchLab.tsx:516',
]);

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx')) acc.push(p.split(path.sep).join('/'));
  }
  return acc;
}

/** 找到 `<button` / `<label` 开标签的结束 `>`（跳过 JSX 表达式里的花括号）。 */
function openTagEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** 取元素的子内容（到配对的闭合标签为止；自闭合返回空串）。 */
function elementChildren(src, tagName, tagEnd) {
  if (src[tagEnd - 1] === '/') return '';
  const close = `</${tagName}>`;
  const idx = src.indexOf(close, tagEnd);
  return idx < 0 ? '' : src.slice(tagEnd + 1, idx);
}

/**
 * 子内容里是否存在可见文字。
 *
 * 两类容易判错的表达式，必须分开：
 * - `{isPublishing ? <Loader2/> : <PenLine/>}` —— 只是在两个图标之间切换，按钮上一个字都没有。
 * - `{isOpen ? t('a') : t('b')}` / `{resolveName(agent)}` —— 渲染出的就是文字。
 *
 * 判据：表达式里出现 `t(` 调用、字符串字面量，或看起来像取文本的标识符，即算有文字；
 * 其余表达式（纯图标/布尔切换）剥掉后再看是否剩下裸文本。
 */
/** 大写变体不加词界：`resolveAgentLocalizedName(...)` 里的 Name 也算取文本。 */
const TEXTUAL_IDENTIFIER = /\b(label|name|title|text|children|count)\b|Name|Label|Text|Title/;

function expressionRendersText(expr) {
  if (/\bt\(/.test(expr)) return true;
  if (/['"][^'"]*[A-Za-z一-鿿][^'"]*['"]/.test(expr)) return true;
  return TEXTUAL_IDENTIFIER.test(expr);
}

function hasVisibleText(children) {
  const withoutTags = children.replace(/<[^>]*>/g, ' ');
  const stripped = withoutTags.replace(/\{[^{}]*\}/g, (expr) =>
    expressionRendersText(expr) ? ' TEXT ' : ' ',
  );
  return /[A-Za-z一-鿿]{2,}/.test(stripped);
}

const gaps = [];
let iconOnlyTotal = 0;

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /<(button|label)\b/g;
  let m;

  while ((m = re.exec(src))) {
    const tagName = m[1];
    const tagEnd = openTagEnd(src, m.index);
    if (tagEnd < 0) continue;

    const openTag = src.slice(m.index, tagEnd + 1);
    const children = elementChildren(src, tagName, tagEnd);

    // 表单 label 包着 input：文案是旁边的 label 文本，不是提示
    if (tagName === 'label' && /<input\b/.test(children) && hasVisibleText(children)) continue;
    // 有可见文字的控件不需要额外提示
    if (hasVisibleText(children)) continue;

    const line = src.slice(0, m.index).split('\n').length;
    if (EXEMPT.has(`${file}:${line}`)) continue;

    iconOnlyTotal++;
    const wrapped = /<Tooltip\b[\s\S]{0,400}$/.test(src.slice(Math.max(0, m.index - 400), m.index));
    const hasAria = /\baria-label=/.test(openTag);
    if (!wrapped && !hasAria) gaps.push(`${file}:${line}`);
  }
}

console.log(`纯图标控件: ${iconOnlyTotal} | 缺提示: ${gaps.length}`);
if (gaps.length > 0) {
  for (const g of gaps) console.log(`  ${g}`);
  process.exit(1);
}
console.log('[audit-tooltips] ok — 每个纯图标控件都有悬停提示');
