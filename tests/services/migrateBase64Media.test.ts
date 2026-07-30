import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  parseDataUrl,
  migrateBase64MediaNodes,
  MIGRATION_BATCH_LIMIT,
} from '../../src/services/migrateBase64Media';

const mediaImportBytes = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/services/mediaStore', () => ({ mediaImportBytes }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

/** "hi" 的 base64。 */
const HI = 'aGk=';

describe('parseDataUrl', () => {
  it('解出字节与扩展名', () => {
    const parsed = parseDataUrl(`data:image/png;base64,${HI}`)!;
    expect(Array.from(parsed.bytes)).toEqual([104, 105]);
    expect(parsed.ext).toBe('png');
  });

  it('jpeg 归一成 jpg', () => {
    expect(parseDataUrl(`data:image/jpeg;base64,${HI}`)!.ext).toBe('jpg');
  });

  it('认得视频与文档的 MIME', () => {
    expect(parseDataUrl(`data:video/mp4;base64,${HI}`)!.ext).toBe('mp4');
  });

  it('MIME 子类型带杂字符时清洗', () => {
    expect(parseDataUrl(`data:image/svg+xml;base64,${HI}`)!.ext).toBe('svgxml');
  });

  it('前后空白无所谓', () => {
    expect(parseDataUrl(`  data:image/png;base64,${HI}  `)).not.toBeNull();
  });

  it('非 data URL 返回 null', () => {
    expect(parseDataUrl('http://example.com/a.png')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
    expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
  });

  it('base64 损坏时返回 null 而不是抛错', () => {
    expect(parseDataUrl('data:image/png;base64,@@@@')).toBeNull();
  });
});

describe('migrateBase64MediaNodes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
    mediaImportBytes.mockResolvedValue({ rel: 'media/uploaded/2026/07/x.png' });
    await db.nodes.clear();
  });

  it('把 data URL 节点搬到文件存储并清掉 base64', async () => {
    await db.nodes.add({
      id: 'n1',
      canvasId: 'default',
      type: 'image',
      content: `data:image/png;base64,${HI}`,
      description: '旧图.png',
      x: 0,
      y: 0,
    });

    const migrated = await migrateBase64MediaNodes();

    expect(migrated).toBe(1);
    expect(mediaImportBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'png',
      'uploaded',
      '旧图.png',
    );
    const row = await db.nodes.get('n1');
    expect(row?.filePath).toBe('media/uploaded/2026/07/x.png');
    // 搬完必须清掉，否则 IndexedDB 里还留着整份 base64
    expect(row?.content).toBe('');
    expect(row?.fileName).toBe('旧图.png');
  });

  it('文档归到 documents 分类', async () => {
    await db.nodes.add({
      id: 'd1',
      type: 'document',
      content: `data:application/msword;base64,${HI}`,
      x: 0,
      y: 0,
    });
    await migrateBase64MediaNodes();
    expect(mediaImportBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'msword',
      'documents',
      undefined,
    );
  });

  it('已有 filePath 的节点跳过', async () => {
    await db.nodes.add({
      id: 'n2',
      type: 'image',
      filePath: 'media/uploaded/done.png',
      content: `data:image/png;base64,${HI}`,
      x: 0,
      y: 0,
    });
    expect(await migrateBase64MediaNodes()).toBe(0);
    expect(mediaImportBytes).not.toHaveBeenCalled();
  });

  it('普通文本节点不受影响', async () => {
    await db.nodes.add({ id: 't1', type: 'text', content: '一条便签', x: 0, y: 0 });
    expect(await migrateBase64MediaNodes()).toBe(0);
    expect((await db.nodes.get('t1'))?.content).toBe('一条便签');
  });

  it('单条失败不影响其他条，且失败那条原样留着', async () => {
    await db.nodes.bulkAdd([
      { id: 'a', type: 'image', content: `data:image/png;base64,${HI}`, x: 0, y: 0 },
      { id: 'b', type: 'image', content: `data:image/png;base64,${HI}`, x: 0, y: 0 },
    ]);
    mediaImportBytes
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({ rel: 'media/uploaded/b.png' });

    expect(await migrateBase64MediaNodes()).toBe(1);

    const a = await db.nodes.get('a');
    // 失败的这条 content 必须留着——渲染层靠它兜底显示
    expect(a?.filePath).toBeUndefined();
    expect(a?.content).toContain('data:image/png;base64');
  });

  it('一次最多搬 limit 条，剩下的留给下次启动', async () => {
    await db.nodes.bulkAdd(
      Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        type: 'image',
        content: `data:image/png;base64,${HI}`,
        x: 0,
        y: 0,
      })),
    );
    expect(await migrateBase64MediaNodes(2)).toBe(2);
    expect(mediaImportBytes).toHaveBeenCalledTimes(2);
  });

  it('不在桌面端时直接跳过，一条都不动', async () => {
    isTauriRuntime.mockReturnValue(false);
    await db.nodes.add({ id: 'n3', type: 'image', content: `data:image/png;base64,${HI}`, x: 0, y: 0 });

    expect(await migrateBase64MediaNodes()).toBe(0);
    expect(mediaImportBytes).not.toHaveBeenCalled();
    expect((await db.nodes.get('n3'))?.content).toContain('data:');
  });

  it('没有待迁移数据时是空操作', async () => {
    expect(await migrateBase64MediaNodes()).toBe(0);
  });

  it('默认批量上限是个正数', () => {
    expect(MIGRATION_BATCH_LIMIT).toBeGreaterThan(0);
  });
});
