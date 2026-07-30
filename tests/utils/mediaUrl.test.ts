import { describe, it, expect } from 'vitest';
import { mediaUrl, resolveNodeMediaSrc } from '../../src/utils/mediaUrl';

describe('mediaUrl', () => {
  it('拼成 spoor-media 协议的 URL', () => {
    expect(mediaUrl('media/generated/2026/07/ab12.png')).toBe(
      'http://spoor-media.localhost/media/generated/2026/07/ab12.png',
    );
  });

  it('前导斜杠不会拼出双斜杠', () => {
    expect(mediaUrl('/media/a.png')).toBe('http://spoor-media.localhost/media/a.png');
    expect(mediaUrl('///media/a.png')).toBe('http://spoor-media.localhost/media/a.png');
  });

  it('逐段编码：分隔符保留，段内特殊字符转义', () => {
    // 整串 encodeURIComponent 会把 `/` 也编掉，那样 Rust 侧就只剩一段路径
    expect(mediaUrl('media/uploaded/我的 图片.png')).toBe(
      'http://spoor-media.localhost/media/uploaded/%E6%88%91%E7%9A%84%20%E5%9B%BE%E7%89%87.png',
    );
  });

  it('# 和 ? 被转义，不会被当成 fragment / query', () => {
    const url = mediaUrl('media/uploaded/a#b?c.png');
    expect(url).toBe('http://spoor-media.localhost/media/uploaded/a%23b%3Fc.png');
    expect(url).not.toContain('#b');
  });

  it('百分号本身也转义，避免二次解码歧义', () => {
    expect(mediaUrl('media/uploaded/100%.png')).toBe(
      'http://spoor-media.localhost/media/uploaded/100%25.png',
    );
  });
});

describe('resolveNodeMediaSrc', () => {
  it('优先用 filePath', () => {
    expect(resolveNodeMediaSrc({ filePath: 'media/uploaded/a.png' })).toBe(
      'http://spoor-media.localhost/media/uploaded/a.png',
    );
  });

  it('filePath 存在时忽略旧的 content', () => {
    expect(
      resolveNodeMediaSrc({ filePath: 'media/uploaded/a.png', content: 'data:image/png;base64,X' }),
    ).toBe('http://spoor-media.localhost/media/uploaded/a.png');
  });

  it('没有 filePath 时回退到 content（旧的 data URL）', () => {
    expect(resolveNodeMediaSrc({ content: 'data:image/png;base64,X' })).toBe(
      'data:image/png;base64,X',
    );
  });

  it('两者皆空返回 undefined，交给调用方显示占位', () => {
    expect(resolveNodeMediaSrc({})).toBeUndefined();
    expect(resolveNodeMediaSrc({ content: '' })).toBeUndefined();
    expect(resolveNodeMediaSrc({ filePath: '', content: '' })).toBeUndefined();
  });
});
