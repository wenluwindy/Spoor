/**
 * i18n 守卫。挂在 `npm run lint` 里，两件事：
 *
 * 1. en / zh 的键集必须完全一致——缺一个键在界面上就是漏出原文 key。
 * 2. 源码里不得出现裸英文 UI 文案（`title=` / `placeholder=` / `alt=` / `aria-label=`
 *    的字面量，以及 JSX 文本节点里的英文短语）。
 *
 * 不解析 TS，直接按文本扫描：这里要的是「别再退化」的粗筛，误报靠白名单收敛，
 * 引入 AST 依赖不划算。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
/** 语言资源目录：每个顶层命名空间一个文件，文件名即命名空间名，index.ts 只做组装。 */
const LOCALES = { en: 'src/i18n/en', zh: 'src/i18n/zh' };

/** 允许保留原文的字面量：品牌名、密钥格式示例、编号、纯符号。 */
const LITERAL_ALLOWLIST = new Set([
  'Spoor',
  'English',
  'Aa',
  'REF-042',
  'sk-metaso-...',
  'ark-...',
  'tp-...',
  'ep-...',
  'gpt-4o',
  'gemini-1.5-flash',
  'mimo-v2.5-pro',
  'Google Gemini',
  'OpenAI (GPT)',
  'Anthropic (Claude)',
  'MiMo (小米大模型)',
  'DeepSeek',
]);

/** 这些文件按设计包含英文：语言资源本身、以及给模型看的提示词。 */
const FILE_ALLOWLIST = [/^src\/i18n\//, /^src\/constants\/aiProviderDocs\.ts$/];

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p.split(path.sep).join('/'));
  }
  return acc;
}

function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flattenKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

/**
 * 从 `export const xx = { … };` 里取出对象字面量并求值。
 * 资源文件是纯 JSON 风格 + 一个 `agentDefaultsXx` 引用，把后者替换成占位对象即可。
 */
function evalObjectLiteral(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('{', src.indexOf('export const'));
  const end = src.lastIndexOf('};');
  if (start < 0 || end < 0) throw new Error(`${file}: 无法定位对象字面量`);
  const body = src.slice(start, end + 1).replace(/agentDefaults(En|Zh)/g, '{}');
  return new Function(`return ${body}`)();
}

/**
 * 逐文件合并命名空间目录（文件名即顶层命名空间），得到与 index.ts 组装结果相同形状的对象。
 * 不求值 index.ts——它只是 import + 简写属性，无法脱离模块系统直接执行；
 * 但顺带检查每个命名空间文件都被 index.ts 引用了，防止「文件加了、忘了挂上」的漏键。
 */
function loadLocale(dir) {
  const indexSrc = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  const locale = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue;
    const ns = name.replace(/\.ts$/, '');
    if (!indexSrc.includes(`from './${ns}'`)) {
      problems.push(`${dir}/index.ts: 未引用命名空间文件 "./${ns}"，其中的键不会生效`);
    }
    locale[ns] = evalObjectLiteral(path.join(dir, name));
  }
  return locale;
}

const problems = [];

// --- 1. 键集一致性 ---
const keys = Object.fromEntries(
  Object.entries(LOCALES).map(([lng, file]) => [lng, new Set(flattenKeys(loadLocale(file)))]),
);
for (const [a, b] of [
  ['en', 'zh'],
  ['zh', 'en'],
]) {
  for (const key of keys[a]) {
    if (!keys[b].has(key)) problems.push(`${LOCALES[b]}: 缺少键 "${key}"（${a} 有）`);
  }
}

// --- 2. 裸英文文案 ---
const ATTR_RE = /\b(title|placeholder|alt|aria-label)="([^"]*)"/g;
/** JSX 文本节点里独占一行的英文短语（两个及以上英文单词）。 */
const TEXT_RE = /^\s*([A-Z][a-zA-Z]*(?:\s+[a-zA-Z]+){1,})\s*$/;

for (const file of walk(SRC)) {
  if (FILE_ALLOWLIST.some((re) => re.test(file))) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, i) => {
    for (const m of line.matchAll(ATTR_RE)) {
      const value = m[2];
      if (!value || LITERAL_ALLOWLIST.has(value)) continue;
      // 只报英文；中文字面量由「硬编码回归」用例逐条盯，这里不重复告警
      if (!/[a-zA-Z]{2}/.test(value)) continue;
      problems.push(`${file}:${i + 1}: ${m[1]}="${value}" 未走 i18n`);
    }

    const text = TEXT_RE.exec(line);
    if (text) {
      const phrase = text[1].trim();
      const prev = lines[i - 1] ?? '';
      const next = lines[i + 1] ?? '';
      const insideJsx = prev.trimEnd().endsWith('>') && next.trimStart().startsWith('<');
      if (insideJsx && !LITERAL_ALLOWLIST.has(phrase)) {
        problems.push(`${file}:${i + 1}: JSX 文本 "${phrase}" 未走 i18n`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`\n[check-i18n] 发现 ${problems.length} 个问题：\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n如确为品牌名/密钥示例等应保留原文的内容，请加入 scripts/check-i18n.mjs 的白名单。\n');
  process.exit(1);
}

const total = keys.en.size;
console.log(`[check-i18n] ok — en/zh 各 ${total} 个键，无裸文案`);
