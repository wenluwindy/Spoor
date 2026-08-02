/**
 * docx 转出的 HTML 白名单清洗器。
 *
 * mammoth 转换的结果会经 `dangerouslySetInnerHTML` 直接进 DOM（见
 * `DocumentNode`），一份恶意 docx 就能带进 `<script>`、`onerror`、
 * `javascript:` 链接。这里不引第三方库，用 DOMParser 把 HTML 解析成
 * 惰性文档（解析期间不执行脚本、不加载资源）再按白名单重建：
 *
 * - 标签白名单外的元素：危险容器（script/style/iframe/svg 等）连同内容
 *   整棵删掉；其余未知标签只拆壳保留子内容，避免丢正文。
 * - 属性一律剥除，只留逐标签声明过的几个；URL 属性再过协议白名单。
 * - `<a>` 强制 `rel="noopener noreferrer"`，不允许 `target`——桌面
 *   webview 里开新窗口没有意义。
 *
 * 导入时（[`fileImport`]）洗一遍，入库即干净；[`DocumentNode`] 渲染前
 * 再洗一遍，防的是清洗器上线前落库的旧数据。两处共用本函数。
 */

/** 允许保留的标签。 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'blockquote', 'pre', 'code', 'span', 'a', 'img', 'hr', 'sup', 'sub',
]);

/**
 * 连同子树一并删除的标签。
 *
 * 这些要么本身能执行/加载内容（script、iframe、object…），要么是已知的
 * mXSS 载体（svg、math 的命名空间切换），保留其文本内容没有意义。
 */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'template', 'noscript', 'svg', 'math', 'link', 'meta', 'base',
  'title', 'form', 'input', 'button', 'textarea', 'select', 'option',
  'audio', 'video', 'source', 'track', 'canvas', 'dialog', 'slot',
]);

/** 逐标签的属性白名单。URL 类属性另有协议校验。 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

/**
 * 协议判定前先剥掉控制字符与空白（码位 <= 0x20）。
 *
 * 浏览器解析 URL 时会忽略散落在其中的制表符/换行，`java\tscript:` 在
 * 校验里若按原文匹配就漏了，剥干净再看前缀才是浏览器实际的视角。
 */
function stripUrlNoise(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x20) out += value[i];
  }
  return out;
}

/** `<a href>`：只放行 http/https/mailto。 */
function isSafeLinkHref(value: string): boolean {
  return /^(?:https?:|mailto:)/i.test(stripUrlNoise(value));
}

/** `<img src>`：只放行 http/https 与 `data:image/*`。 */
function isSafeImageSrc(value: string): boolean {
  const v = stripUrlNoise(value);
  return /^https?:/i.test(v) || /^data:image\/[a-z0-9.+-]+[;,]/i.test(v);
}

/** 把元素上白名单之外的属性全部剥掉，URL 属性再做协议校验。 */
function sanitizeAttributes(el: Element, tag: string): void {
  const allowed = ALLOWED_ATTRS[tag];
  // 先快照再删：直接遍历 NamedNodeMap 边删边走会跳项
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowed || !allowed.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (tag === 'a' && name === 'href' && !isSafeLinkHref(attr.value)) {
      el.removeAttribute(attr.name);
    } else if (tag === 'img' && name === 'src' && !isSafeImageSrc(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
  if (tag === 'a') {
    // target 不在白名单里已被剥掉；rel 统一强制，防 window.opener 反向操纵
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/** 深度优先清洗一个节点的子树。 */
function sanitizeNode(node: Node): void {
  // 先快照：过程中会移除/拆壳子节点
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;

    if (child.nodeType !== Node.ELEMENT_NODE) {
      // 注释、CDATA、处理指令等一律不留
      node.removeChild(child);
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      node.removeChild(el);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // 未知但无害的容器（div、figure…）：拆壳保留子内容，先清洗再上提
      sanitizeNode(el);
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      node.removeChild(el);
      continue;
    }

    sanitizeAttributes(el, tag);
    sanitizeNode(el);
  }
}

/**
 * 按白名单清洗一段 HTML，返回可安全交给 `dangerouslySetInnerHTML` 的串。
 *
 * 输入不是合法 HTML 也不要紧：DOMParser 按浏览器容错规则解析，
 * 清洗针对解析后的树进行，与最终进 DOM 的形态一致。
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}
