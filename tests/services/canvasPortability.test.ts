import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/db';

const saveTextFile = vi.fn(async () => true);
const saveTextFileTo = vi.fn(async () => {});
const pickDirectory = vi.fn<() => Promise<string | null>>(async () => null);
const openTextFile = vi.fn<() => Promise<{ fileName: string; text: string } | null>>(
  async () => null,
);
const mediaExport = vi.fn(async () => {});
const isTauriRuntime = vi.fn(() => false);

vi.mock('../../src/utils/userTextFile', () => ({
  saveTextFile: (...args: unknown[]) => saveTextFile(...(args as [])),
  saveTextFileTo: (...args: unknown[]) => saveTextFileTo(...(args as [])),
  pickDirectory: () => pickDirectory(),
  openTextFile: () => openTextFile(),
}));

vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime: () => isTauriRuntime() }));

vi.mock('../../src/services/mediaStore', () => ({
  mediaExport: (...args: unknown[]) => mediaExport(...(args as [])),
}));

const { exportCanvasAsMarkdown, exportCanvasToFile, importCanvasFromFile, toSafeFileName } =
  await import('../../src/services/canvasPortability');

describe('canvasPortability', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.agents.clear();
    saveTextFile.mockClear();
    saveTextFileTo.mockClear();
    pickDirectory.mockClear();
    openTextFile.mockClear();
    mediaExport.mockClear();
    saveTextFile.mockResolvedValue(true);
    mediaExport.mockResolvedValue(undefined);
    isTauriRuntime.mockReturnValue(false);
  });

  describe('导出', () => {
    it('只导出该画布的节点与连线', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', canvasId: 'c1', type: 'text', content: '本画布', x: 0, y: 0 },
        { id: 'n2', canvasId: 'c1', type: 'text', content: '本画布二', x: 10, y: 0 },
        { id: 'n3', canvasId: 'c2', type: 'text', content: '别的画布', x: 0, y: 0 },
      ]);
      await db.edges.bulkAdd([
        { id: 'e1', canvasId: 'c1', from: 'n1', to: 'n2' },
        { id: 'e2', canvasId: 'c2', from: 'n3', to: 'n3' },
      ]);

      await exportCanvasToFile('c1', '第一张');

      const [fileName, contents] = saveTextFile.mock.calls[0] as unknown as [string, string];
      expect(fileName).toBe('第一张.canvas');
      const doc = JSON.parse(contents);
      expect(doc.nodes.map((n: { text: string }) => n.text)).toEqual(['本画布', '本画布二']);
      expect(doc.edges).toHaveLength(1);
    });

    it('没有 canvasId 的旧数据算在 default 画布名下', async () => {
      await db.nodes.add({ id: 'n1', type: 'text', content: '老节点', x: 0, y: 0 });

      await exportCanvasToFile('default', '默认');

      const [, contents] = saveTextFile.mock.calls[0] as unknown as [string, string];
      expect(JSON.parse(contents).nodes).toHaveLength(1);
    });

    it('画布名里的非法文件名字符换成短横', () => {
      expect(toSafeFileName('研究/2026: 计划?')).toBe('研究-2026- 计划-');
      expect(toSafeFileName('   ')).toBe('canvas');
    });

    it('用户取消保存对话框时返回 false', async () => {
      saveTextFile.mockResolvedValue(false);
      expect(await exportCanvasToFile('c1', '第一张')).toBe(false);
    });
  });

  describe('导入', () => {
    const validFile = {
      fileName: '别处来的.canvas',
      text: JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '甲' },
          { id: 'b', type: 'text', x: 300, y: 0, width: 200, height: 100, text: '乙' },
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
      }),
    };

    it('落到一张新画布，名字取自文件名', async () => {
      openTextFile.mockResolvedValue(validFile);

      const outcome = (await importCanvasFromFile())!;
      expect(outcome.canvasName).toBe('别处来的');
      expect(outcome.nodeCount).toBe(2);
      expect(outcome.edgeCount).toBe(1);

      const canvas = await db.canvases.get(outcome.canvasId);
      expect(canvas?.name).toBe('别处来的');

      const nodes = await db.nodes.toArray();
      expect(nodes.every((n) => n.canvasId === outcome.canvasId)).toBe(true);
    });

    it('不并进当前画布：已有画布的内容一个不动', async () => {
      await db.nodes.add({ id: 'old', canvasId: 'c1', type: 'text', content: '原有', x: 0, y: 0 });
      openTextFile.mockResolvedValue(validFile);

      await importCanvasFromFile();

      const stillThere = await db.nodes.get('old');
      expect(stillThere?.canvasId).toBe('c1');
    });

    it('用户取消时返回 null，什么都不写', async () => {
      openTextFile.mockResolvedValue(null);
      expect(await importCanvasFromFile()).toBeNull();
      expect(await db.canvases.count()).toBe(0);
    });

    it('文件不是合法 JSON Canvas 时抛错，且不留下空壳画布', async () => {
      openTextFile.mockResolvedValue({ fileName: 'x.canvas', text: '这不是 JSON' });

      await expect(importCanvasFromFile()).rejects.toThrow('invalid_json_canvas');
      expect(await db.canvases.count()).toBe(0);
      expect(await db.nodes.count()).toBe(0);
    });

    it('如实报出降级情况', async () => {
      openTextFile.mockResolvedValue({
        fileName: 'mixed.canvas',
        text: JSON.stringify({
          nodes: [
            { id: 'a', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://example.com' },
            { id: 'b', type: 'group', x: 0, y: 0, width: 9, height: 9, label: '一组' },
            { id: 'c', type: '未来类型', x: 0, y: 0 },
          ],
          edges: [],
        }),
      });

      const outcome = (await importCanvasFromFile())!;
      expect(outcome.degraded).toEqual({ links: 1, groups: 1, skipped: 1 });
    });
  });

  describe('导出 Markdown 包', () => {
    const NOW = new Date(2026, 7, 1);

    beforeEach(async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', canvasId: 'c1', type: 'text', content: '一段想法', x: 0, y: 0 },
        {
          id: 'n2',
          canvasId: 'c1',
          type: 'image',
          filePath: 'media/uploaded/a.png',
          fileName: 'a.png',
          x: 0,
          y: 400,
        },
      ]);
    });

    it('桌面端写正文并把媒体复制进 assets/', async () => {
      isTauriRuntime.mockReturnValue(true);
      pickDirectory.mockResolvedValue('D:/导出');

      const outcome = (await exportCanvasAsMarkdown('c1', '第一张', NOW))!;

      expect(saveTextFileTo).toHaveBeenCalledWith('D:/导出/第一张.md', expect.stringContaining('一段想法'));
      expect(mediaExport).toHaveBeenCalledWith('media/uploaded/a.png', 'D:/导出/assets/a.png');
      expect(outcome).toMatchObject({ directory: 'D:/导出', assetsCopied: 1, assetsMissing: 0 });
    });

    it('正文里的图片链接指向包内的 assets/', async () => {
      isTauriRuntime.mockReturnValue(true);
      pickDirectory.mockResolvedValue('D:/导出');

      await exportCanvasAsMarkdown('c1', '第一张', NOW);

      const [, markdown] = saveTextFileTo.mock.calls[0] as unknown as [string, string];
      expect(markdown).toContain('](assets/a.png)');
    });

    it('某个原件复制失败时照样出包，并如实计数', async () => {
      isTauriRuntime.mockReturnValue(true);
      pickDirectory.mockResolvedValue('D:/导出');
      mediaExport.mockRejectedValue(new Error('not_found'));

      const outcome = (await exportCanvasAsMarkdown('c1', '第一张', NOW))!;

      expect(saveTextFileTo).toHaveBeenCalled();
      expect(outcome).toMatchObject({ assetsCopied: 0, assetsMissing: 1 });
    });

    it('用户取消选目录时什么都不写', async () => {
      isTauriRuntime.mockReturnValue(true);
      pickDirectory.mockResolvedValue(null);

      expect(await exportCanvasAsMarkdown('c1', '第一张', NOW)).toBeNull();
      expect(saveTextFileTo).not.toHaveBeenCalled();
      expect(mediaExport).not.toHaveBeenCalled();
    });

    it('浏览器调试时退回只下载一个 .md', async () => {
      isTauriRuntime.mockReturnValue(false);

      const outcome = (await exportCanvasAsMarkdown('c1', '第一张', NOW))!;

      expect(saveTextFile).toHaveBeenCalledWith(
        '第一张.md',
        expect.stringContaining('一段想法'),
        expect.anything(),
      );
      expect(outcome.directory).toBeNull();
      expect(mediaExport).not.toHaveBeenCalled();
    });
  });
});
