import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  htmlToPlainText,
  collectAttachmentImages,
  buildAttachmentContextText,
  fileToToolbarAttachment,
} from '../../src/utils/toolbarAttachments';
import type { ToolbarAttachment } from '../../src/constants/toolbarAttachments';
import { TOOLBAR_ATTACHMENT_ACCEPT } from '../../src/constants/toolbarAttachments';
import { isAppError } from '../../src/services/appError';

const readFileContent = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/file', () => ({ readFileContent }));

const img = (id: string, name: string): ToolbarAttachment => ({
  id,
  name,
  kind: 'image',
  dataUrl: `data:image/png;base64,${id}`,
});
const doc = (id: string, name: string, text: string): ToolbarAttachment => ({
  id,
  name,
  kind: 'text',
  text,
});

describe('TOOLBAR_ATTACHMENT_ACCEPT', () => {
  it('不含视频：视频当不了提示词上下文', () => {
    expect(TOOLBAR_ATTACHMENT_ACCEPT).not.toContain('video');
  });

  it('覆盖图片与三种文档', () => {
    expect(TOOLBAR_ATTACHMENT_ACCEPT).toContain('image/*');
    expect(TOOLBAR_ATTACHMENT_ACCEPT).toContain('.docx');
    expect(TOOLBAR_ATTACHMENT_ACCEPT).toContain('.txt');
    expect(TOOLBAR_ATTACHMENT_ACCEPT).toContain('.md');
  });
});

describe('htmlToPlainText', () => {
  it('剥掉标签只留正文', () => {
    expect(htmlToPlainText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段');
  });

  it('<br> 与块级闭合标签变成换行', () => {
    expect(htmlToPlainText('<p>a<br/>b</p>')).toBe('a\nb');
    expect(htmlToPlainText('<li>一</li><li>二</li>')).toBe('一\n二');
  });

  it('解码常见实体', () => {
    expect(htmlToPlainText('<p>a&nbsp;&amp;&nbsp;b &lt;tag&gt; &quot;q&quot; &#39;s&#39;</p>')).toBe(
      'a & b <tag> "q" \'s\'',
    );
  });

  it('压掉连续空行', () => {
    expect(htmlToPlainText('<p>a</p><p></p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('空输入得到空串', () => {
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText('<p></p>')).toBe('');
  });
});

describe('collectAttachmentImages', () => {
  it('只取图片的 data URL，保持顺序', () => {
    const list = [img('1', 'a.png'), doc('2', 'b.md', 'x'), img('3', 'c.jpg')];
    expect(collectAttachmentImages(list)).toEqual([
      'data:image/png;base64,1',
      'data:image/png;base64,3',
    ]);
  });

  it('没有图片时返回空数组', () => {
    expect(collectAttachmentImages([doc('1', 'a.md', 'x')])).toEqual([]);
  });

  it('缺 dataUrl 的图片被跳过', () => {
    expect(collectAttachmentImages([{ id: '1', name: 'a.png', kind: 'image' }])).toEqual([]);
  });
});

describe('buildAttachmentContextText', () => {
  const label = (name: string) => `【附件：${name}】`;

  it('没有文本附件时返回空串', () => {
    expect(buildAttachmentContextText([], label)).toBe('');
    expect(buildAttachmentContextText([img('1', 'a.png')], label)).toBe('');
  });

  it('每份文档带上文件名，之间空一行', () => {
    const list = [doc('1', '大纲.md', '第一章'), doc('2', '会议.txt', '结论：先做 A')];
    expect(buildAttachmentContextText(list, label)).toBe(
      '【附件：大纲.md】\n第一章\n\n【附件：会议.txt】\n结论：先做 A',
    );
  });

  it('跳过正文为空白的文档', () => {
    const list = [doc('1', 'empty.md', '   '), doc('2', 'ok.md', '有内容')];
    expect(buildAttachmentContextText(list, label)).toBe('【附件：ok.md】\n有内容');
  });
});

describe('fileToToolbarAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const file = (name: string) => new File(['x'], name);

  it('图片保留 data URL', async () => {
    readFileContent.mockResolvedValue({ type: 'image', content: 'data:image/png;base64,Z' });
    const a = await fileToToolbarAttachment(file('封面.png'));
    expect(a).toMatchObject({ name: '封面.png', kind: 'image', dataUrl: 'data:image/png;base64,Z' });
    expect(a.id).toBeTruthy();
  });

  it('docx 转成的 HTML 会被拆成纯文本', async () => {
    readFileContent.mockResolvedValue({ type: 'document', content: '<p>正文</p><p>第二段</p>' });
    const a = await fileToToolbarAttachment(file('稿子.docx'));
    expect(a).toMatchObject({ kind: 'text', text: '正文\n第二段' });
  });

  it('txt/md 原样作为正文', async () => {
    readFileContent.mockResolvedValue({ type: 'text', content: '# 标题\n正文' });
    const a = await fileToToolbarAttachment(file('大纲.md'));
    expect(a).toMatchObject({ kind: 'text', text: '# 标题\n正文' });
  });

  it('视频报「不支持」而不是被静默丢弃', async () => {
    readFileContent.mockResolvedValue({ type: 'video', content: 'data:video/mp4;base64,Z' });
    const err = await fileToToolbarAttachment(file('片段.mp4')).catch((e) => e);
    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe('file.unsupported');
  });

  it('每份附件拿到不同的 id', async () => {
    readFileContent.mockResolvedValue({ type: 'text', content: 'a' });
    const a = await fileToToolbarAttachment(file('1.md'));
    const b = await fileToToolbarAttachment(file('2.md'));
    expect(a.id).not.toBe(b.id);
  });
});
