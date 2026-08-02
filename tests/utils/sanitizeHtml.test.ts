import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../../src/utils/sanitizeHtml';

describe('sanitizeHtml — 注入拦截', () => {
  it('script 连同内容整棵删掉', () => {
    const out = sanitizeHtml('<p>前</p><script>alert(1)</script><p>后</p>');
    expect(out).toBe('<p>前</p><p>后</p>');
    expect(out).not.toContain('alert');
  });

  it('iframe / object / embed 整棵删掉', () => {
    expect(sanitizeHtml('<iframe src="https://evil.example"></iframe>')).toBe('');
    expect(sanitizeHtml('<object data="x"></object><embed src="x">')).toBe('');
  });

  it('style 标签整棵删掉（CSS 走不到白名单里）', () => {
    expect(sanitizeHtml('<style>p{background:url(javascript:1)}</style><p>a</p>')).toBe('<p>a</p>');
  });

  it('事件属性 onerror/onclick 剥除', () => {
    const out = sanitizeHtml('<img src="https://a.example/x.png" onerror="alert(1)"><p onclick="alert(2)">a</p>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<img src="https://a.example/x.png">');
  });

  it('style 属性剥除', () => {
    const out = sanitizeHtml('<p style="position:fixed;inset:0">a</p><span class="x" data-y="1">b</span>');
    expect(out).toBe('<p>a</p><span>b</span>');
  });

  it('javascript: href 剥除，链接文字保留', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">点我</a>');
    expect(out).not.toContain('javascript');
    expect(out).toContain('点我');
  });

  it('href 里混控制字符绕不过协议检查', () => {
    const out = sanitizeHtml('<a href="java\tscri\npt:alert(1)">x</a>');
    expect(out).not.toContain('script:');
  });

  it('img 的 javascript:/data:text/html src 剥除', () => {
    expect(sanitizeHtml('<img src="javascript:alert(1)">')).not.toContain('src');
    expect(sanitizeHtml('<img src="data:text/html,<script>1</script>">')).not.toContain('src');
  });

  it('svg / math（mXSS 载体）整棵删掉', () => {
    expect(sanitizeHtml('<svg><script>alert(1)</script></svg>')).toBe('');
    expect(sanitizeHtml('<math><mtext><script>1</script></mtext></math>')).toBe('');
  });

  it('form 控件与 template 整棵删掉', () => {
    expect(sanitizeHtml('<form action="x"><input onfocus="a()" autofocus></form>')).toBe('');
    expect(sanitizeHtml('<template><script>1</script></template>')).toBe('');
  });

  it('注释不保留（可能藏条件解析花招）', () => {
    expect(sanitizeHtml('<p>a</p><!-- <script>1</script> -->')).toBe('<p>a</p>');
  });

  it('a 强制 rel，target 剥掉', () => {
    const out = sanitizeHtml('<a href="https://a.example" target="_blank" rel="opener">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('target');
  });

  it('mailto 链接放行', () => {
    expect(sanitizeHtml('<a href="mailto:a@b.c">写信</a>')).toContain('href="mailto:a@b.c"');
  });

  it('未知但无害的容器拆壳保留内容', () => {
    expect(sanitizeHtml('<div><p>正文</p></div>')).toBe('<p>正文</p>');
    expect(sanitizeHtml('<figure><img src="https://a.example/x.png"></figure>')).toBe(
      '<img src="https://a.example/x.png">',
    );
  });

  it('空输入返回空串', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('sanitizeHtml — 正常 docx 结构不被破坏', () => {
  it('标题、段落、强调原样保留', () => {
    const html = '<h1>标题</h1><p>正文 <strong>加粗</strong> <em>斜体</em> <u>下划线</u></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('列表与嵌套保留', () => {
    const html = '<ul><li>一</li><li>二<ol><li>2.1</li></ol></li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('表格连 colspan/rowspan 一起保留', () => {
    const html =
      '<table><thead><tr><th colspan="2">表头</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('mammoth 内联的 data URL 图片保留（含 alt）', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="插图">';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('引用、代码、上下标、分隔线保留', () => {
    const html = '<blockquote><p>引文</p></blockquote><pre><code>x = 1</code></pre><p>a<sup>2</sup>+b<sub>i</sub></p><hr>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('https 链接保留 href 并补 rel', () => {
    expect(sanitizeHtml('<a href="https://example.com/x?y=1">链接</a>')).toBe(
      '<a href="https://example.com/x?y=1" rel="noopener noreferrer">链接</a>',
    );
  });

  it('清洗结果是幂等的：入库前洗过，渲染前再洗一遍不再变化', () => {
    const dirty =
      '<h2 style="color:red">题</h2><div><p onclick="x()">正文</p></div>' +
      '<a href="javascript:1" target="_blank">链</a><script>1</script>';
    const once = sanitizeHtml(dirty);
    expect(sanitizeHtml(once)).toBe(once);
  });
});
