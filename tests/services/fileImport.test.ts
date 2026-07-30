import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyFile,
  importPathToNodeData,
  importFileToNodeData,
} from '../../src/services/fileImport';
import { isAppError } from '../../src/services/appError';

const mediaImport = vi.hoisted(() => vi.fn());
const mediaImportBytes = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
const convertToHtml = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/mediaStore', () => ({ mediaImport, mediaImportBytes }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));
vi.mock('mammoth', () => ({ default: { convertToHtml } }));

const EMPTY_DOC = '<p>（空文档）</p>';

describe('classifyFile', () => {
  it('按扩展名认图片', () => {
    expect(classifyFile('a.png').kind).toBe('image');
    expect(classifyFile('a.JPG').kind).toBe('image');
    expect(classifyFile('a.webp').kind).toBe('image');
  });

  it('按扩展名认视频', () => {
    expect(classifyFile('v.mp4').kind).toBe('video');
    expect(classifyFile('v.MKV').kind).toBe('video');
  });

  it('docx 归 document，txt/md 归 text', () => {
    expect(classifyFile('a.docx')).toEqual({ kind: 'document', fileType: 'docx' });
    expect(classifyFile('a.txt')).toEqual({ kind: 'text', fileType: 'text/plain' });
    expect(classifyFile('a.md')).toEqual({ kind: 'text', fileType: 'text/markdown' });
  });

  it('扩展名优先于 MIME：docx 常被嗅探成 zip', () => {
    expect(classifyFile('稿子.docx', 'application/zip').kind).toBe('document');
  });

  it('没有扩展名时回落到 MIME', () => {
    expect(classifyFile('clipboard', 'image/png').kind).toBe('image');
    expect(classifyFile('clipboard', 'video/mp4').kind).toBe('video');
  });

  it('认不出来的落成通用 file 节点而不是报错', () => {
    // 收下总比丢掉好：原件至少留住了
    expect(classifyFile('archive.7z').kind).toBe('file');
    expect(classifyFile('noext').kind).toBe('file');
  });

  it('jpg 的 fileType 归一成 image/jpeg', () => {
    expect(classifyFile('a.jpg').fileType).toBe('image/jpeg');
  });
});

describe('importPathToNodeData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it('图片：归到 uploaded，节点只留相对路径', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/uploaded/2026/07/x.png', fileName: '封面.png' });

    const data = await importPathToNodeData('D:\\pics\\封面.png', EMPTY_DOC);

    expect(mediaImport).toHaveBeenCalledWith('D:\\pics\\封面.png', 'uploaded');
    expect(data).toMatchObject({
      type: 'image',
      filePath: 'media/uploaded/2026/07/x.png',
      fileName: '封面.png',
    });
    // 关键：绝不把 data URL 塞进数据库
    expect(data.content).toBeUndefined();
  });

  it('视频同样归 uploaded 且不入正文', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/uploaded/2026/07/v.mp4', fileName: 'v.mp4' });
    const data = await importPathToNodeData('/home/me/v.mp4', EMPTY_DOC);
    expect(mediaImport).toHaveBeenCalledWith('/home/me/v.mp4', 'uploaded');
    expect(data.type).toBe('video');
    expect(data.content).toBeUndefined();
  });

  it('txt：原件归 documents，正文同时入库', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/documents/2026/07/n.txt', fileName: '会议.txt' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => '第一条\n第二条' }),
    );

    const data = await importPathToNodeData('/tmp/会议.txt', EMPTY_DOC);

    expect(mediaImport).toHaveBeenCalledWith('/tmp/会议.txt', 'documents');
    expect(data.filePath).toBe('media/documents/2026/07/n.txt');
    expect(data.content).toBe('第一条\n第二条');
    expect(data.type).toBe('text');
  });

  it('docx：正文经 mammoth 转 HTML 后入库', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/documents/2026/07/d.docx', fileName: '稿子.docx' });
    convertToHtml.mockResolvedValue({ value: '<p>正文</p>' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );

    const data = await importPathToNodeData('/tmp/稿子.docx', EMPTY_DOC);

    expect(data.type).toBe('document');
    expect(data.content).toBe('<p>正文</p>');
  });

  it('docx 解出来是空的用调用方给的兜底文案', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/documents/2026/07/d.docx', fileName: 'd.docx' });
    convertToHtml.mockResolvedValue({ value: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );

    const data = await importPathToNodeData('/tmp/d.docx', EMPTY_DOC);
    expect(data.content).toBe(EMPTY_DOC);
  });

  it('读正文失败时抛错，而不是落一个空正文的节点', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/documents/2026/07/n.txt', fileName: 'n.txt' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const err = await importPathToNodeData('/tmp/n.txt', EMPTY_DOC).catch((e) => e);
    expect(isAppError(err)).toBe(true);
  });

  it('从 Windows 与 POSIX 路径里都能取出文件名', async () => {
    mediaImport.mockResolvedValue({ rel: 'media/uploaded/a.png', fileName: '' });
    expect((await importPathToNodeData('C:\\a\\b\\图.png', EMPTY_DOC)).fileName).toBe('图.png');
    expect((await importPathToNodeData('/a/b/图.png', EMPTY_DOC)).fileName).toBe('图.png');
  });
});

describe('importFileToNodeData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  function fileOf(name: string, type = '') {
    const f = new File(['xx'], name, { type });
    // jsdom 的 File 没有 arrayBuffer
    Object.defineProperty(f, 'arrayBuffer', { value: async () => new ArrayBuffer(2) });
    return f;
  }

  it('走字节流入库并带上原始文件名', async () => {
    mediaImportBytes.mockResolvedValue({ rel: 'media/uploaded/2026/07/x.png' });

    const data = await importFileToNodeData(fileOf('贴图.png', 'image/png'), EMPTY_DOC);

    expect(mediaImportBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'png',
      'uploaded',
      '贴图.png',
    );
    expect(data).toMatchObject({ type: 'image', filePath: 'media/uploaded/2026/07/x.png' });
  });

  it('没有扩展名时用 bin', async () => {
    mediaImportBytes.mockResolvedValue({ rel: 'media/uploaded/x.bin' });
    await importFileToNodeData(fileOf('clipboard', 'image/png'), EMPTY_DOC);
    expect(mediaImportBytes).toHaveBeenCalledWith(expect.any(Uint8Array), 'bin', 'uploaded', 'clipboard');
  });

  it('不在桌面端时明确报错，而不是静默写一个坏节点', async () => {
    isTauriRuntime.mockReturnValue(false);
    const err = await importFileToNodeData(fileOf('a.png'), EMPTY_DOC).catch((e) => e);
    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe('media.desktop_only');
    expect(mediaImportBytes).not.toHaveBeenCalled();
  });
});
