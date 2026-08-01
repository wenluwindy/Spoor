import { describe, it, expect } from 'vitest';
import {
  EXCERPT_LENGTH,
  absoluteUrl,
  extractWebPageMeta,
  hostLabel,
  isFetchableUrl,
} from '../../src/services/webPage';

describe('webPage', () => {
  describe('识别可抓取的地址', () => {
    it('认 http 与 https', () => {
      expect(isFetchableUrl('https://example.com/a')).toBe(true);
      expect(isFetchableUrl('  http://example.com  ')).toBe(true);
    });

    it('不认别的协议——它们能读本地文件或绕过检查', () => {
      expect(isFetchableUrl('file:///C:/Windows/win.ini')).toBe(false);
      expect(isFetchableUrl('data:text/html,<script>')).toBe(false);
      expect(isFetchableUrl('javascript:alert(1)')).toBe(false);
    });

    it('一整段恰好含链接的文字不算——粘贴一篇文章不该变成网页卡', () => {
      expect(isFetchableUrl('看这个 https://example.com 挺有意思')).toBe(false);
    });

    it('不是地址的文本一律不认', () => {
      expect(isFetchableUrl('随便写点什么')).toBe(false);
      expect(isFetchableUrl('')).toBe(false);
    });
  });

  describe('站点名', () => {
    it('去掉 www 前缀', () => {
      expect(hostLabel('https://www.example.com/a/b')).toBe('example.com');
      expect(hostLabel('https://news.ycombinator.com')).toBe('news.ycombinator.com');
    });

    it('地址坏掉时返回空串而不是抛错', () => {
      expect(hostLabel('不是地址')).toBe('');
    });
  });

  describe('相对地址补全', () => {
    it('按最终地址补成绝对地址', () => {
      expect(absoluteUrl('/img/a.png', 'https://example.com/post/1')).toBe(
        'https://example.com/img/a.png',
      );
    });

    it('已经是绝对地址就原样返回', () => {
      expect(absoluteUrl('https://cdn.example.com/a.png', 'https://example.com')).toBe(
        'https://cdn.example.com/a.png',
      );
    });

    it('空值或坏值返回空串', () => {
      expect(absoluteUrl('', 'https://example.com')).toBe('');
    });
  });

  describe('提取元信息', () => {
    const html = `
      <html><head>
        <title>标签里的标题</title>
        <meta property="og:title" content="OG 标题" />
        <meta property="og:site_name" content="示例站" />
        <meta property="og:description" content="这是站点自己写的摘要。" />
        <meta property="og:image" content="/cover.png" />
      </head><body>
        <nav>导航 导航 导航</nav>
        <article><p>正文第一段。</p><p>正文第二段。</p></article>
        <script>console.log('不该出现在摘要里')</script>
      </body></html>`;

    it('og 标题优先于 title 标签', () => {
      expect(extractWebPageMeta(html, 'https://example.com/p').title).toBe('OG 标题');
    });

    it('没有 og 标题时退回 title 标签', () => {
      const meta = extractWebPageMeta('<html><head><title>只有它</title></head></html>', 'https://x.com');
      expect(meta.title).toBe('只有它');
    });

    it('两者都没有时退回域名，不留空标题', () => {
      const meta = extractWebPageMeta('<html><body>光秃秃</body></html>', 'https://www.example.com/a');
      expect(meta.title).toBe('example.com');
    });

    it('站点自己写的摘要优先于启发式抽出来的正文', () => {
      expect(extractWebPageMeta(html, 'https://example.com/p').excerpt).toBe(
        '这是站点自己写的摘要。',
      );
    });

    it('没有 description 时从正文里抽，且不含脚本与样式', () => {
      const noDesc = `<html><body>
        <script>secretToken()</script>
        <style>.a{color:red}</style>
        <article><p>真正的正文在这里。</p></article>
      </body></html>`;
      const meta = extractWebPageMeta(noDesc, 'https://example.com');
      expect(meta.excerpt).toContain('真正的正文在这里');
      expect(meta.excerpt).not.toContain('secretToken');
      expect(meta.excerpt).not.toContain('color:red');
    });

    it('摘要截断到上限', () => {
      const long = `<html><body><article>${'字'.repeat(2000)}</article></body></html>`;
      expect(extractWebPageMeta(long, 'https://example.com').excerpt).toHaveLength(EXCERPT_LENGTH);
    });

    it('封面的相对地址补成绝对地址', () => {
      expect(extractWebPageMeta(html, 'https://example.com/p').image).toBe(
        'https://example.com/cover.png',
      );
    });

    it('站点名缺失时用域名兜底', () => {
      const meta = extractWebPageMeta('<html><head><title>x</title></head></html>', 'https://www.b.com');
      expect(meta.siteName).toBe('b.com');
    });

    it('最终地址（跟完重定向的那个）记进结果', () => {
      expect(extractWebPageMeta(html, 'https://example.com/final').url).toBe(
        'https://example.com/final',
      );
    });
  });
});
