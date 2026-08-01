import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  BACKUP_FORMAT_VERSION,
  backupFileName,
  buildBackup,
  collectReferencedMedia,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from '../../src/services/backup';

const NOW = 1_754_000_000_000;

async function seed() {
  await db.canvases.add({ id: 'c1', name: '第一张', createdAt: 1, updatedAt: 2 });
  await db.nodes.bulkAdd([
    { id: 'n1', canvasId: 'c1', type: 'text', content: '甲', x: 0, y: 0 },
    {
      id: 'n2',
      canvasId: 'c1',
      type: 'image',
      filePath: 'media/uploaded/a.png',
      x: 10,
      y: 10,
    },
  ]);
  await db.edges.add({ id: 'e1', canvasId: 'c1', from: 'n1', to: 'n2' });
  await db.articles.add({ id: 'a1', title: '长文', content: '正文', date: '2026-08-01', type: 'essay' });
  await db.agents.add({ id: 'mirror', name: '真知镜', role: '反问', prompt: '…' });
}

describe('backup', () => {
  beforeEach(async () => {
    await Promise.all([
      db.canvases.clear(),
      db.nodes.clear(),
      db.edges.clear(),
      db.articles.clear(),
      db.agents.clear(),
      db.researchSessions.clear(),
      db.agentSandboxThreads.clear(),
    ]);
    localStorage.clear();
  });

  describe('打包', () => {
    it('把七张表都装进去', async () => {
      await seed();
      const backup = await buildBackup('0.3.0', NOW);

      expect(backup.tables.canvases).toHaveLength(1);
      expect(backup.tables.nodes).toHaveLength(2);
      expect(backup.tables.edges).toHaveLength(1);
      expect(backup.tables.articles).toHaveLength(1);
      expect(backup.tables.agents).toHaveLength(1);
      expect(backup.version).toBe(BACKUP_FORMAT_VERSION);
      expect(backup.appVersion).toBe('0.3.0');
      expect(backup.createdAt).toBe(NOW);
    });

    it('带上偏好设置，但绝不带 API 密钥', async () => {
      localStorage.setItem('app_theme', 'midnight');
      localStorage.setItem('app_language', 'zh');
      localStorage.setItem('ai_config', JSON.stringify({ providers: [{ apiKey: '绝不能出现' }] }));
      localStorage.setItem('metaso_api_key', '也不能出现');

      const backup = await buildBackup('0.3.0', NOW);

      expect(backup.settings.app_theme).toBe('midnight');
      expect(backup.settings.app_language).toBe('zh');
      expect(backup.settings.ai_config).toBeUndefined();
      expect(backup.settings.metaso_api_key).toBeUndefined();
      expect(serializeBackup(backup)).not.toContain('绝不能出现');
      expect(serializeBackup(backup)).not.toContain('也不能出现');
    });

    it('只记媒体路径清单，不装文件字节', async () => {
      await seed();
      const backup = await buildBackup('0.3.0', NOW);
      expect(backup.media).toEqual(['media/uploaded/a.png']);
    });

    it('媒体清单覆盖生图结果与参考图，且去重排序', () => {
      const paths = collectReferencedMedia([
        {
          id: 'n1',
          type: 'imagegen',
          x: 0,
          y: 0,
          imageGenResults: ['media/generated/b.png', 'media/generated/a.png'],
          imageGenMeta: {
            prompt: '',
            providerName: '',
            modelName: '',
            refPaths: ['media/uploaded/ref.png', 'media/generated/a.png'],
            createdAt: 0,
          },
        },
        { id: 'n2', type: 'image', x: 0, y: 0, filePath: 'media/uploaded/ref.png' },
      ]);
      expect(paths).toEqual([
        'media/generated/a.png',
        'media/generated/b.png',
        'media/uploaded/ref.png',
      ]);
    });

    it('文件名带日期', () => {
      expect(backupFileName(new Date(2026, 7, 1))).toBe('spoor-backup-2026-08-01.json');
      expect(backupFileName(new Date(2026, 11, 25))).toBe('spoor-backup-2026-12-25.json');
    });
  });

  describe('解析', () => {
    it('不是 JSON、不是 Spoor 备份时返回 null', () => {
      expect(parseBackup('随便一段文字')).toBeNull();
      expect(parseBackup('{"format":"别人的备份"}')).toBeNull();
    });

    it('版本比当前新时拒绝——老版本硬还原只会写进残缺的行', () => {
      const future = JSON.stringify({
        format: 'spoor-backup',
        version: BACKUP_FORMAT_VERSION + 1,
        tables: {},
      });
      expect(parseBackup(future)).toBeNull();
    });

    it('缺少表时补成空数组而不是崩掉', () => {
      const partial = parseBackup(
        JSON.stringify({ format: 'spoor-backup', version: 1, tables: { nodes: [] } }),
      )!;
      expect(partial.tables.canvases).toEqual([]);
      expect(partial.tables.agents).toEqual([]);
      expect(partial.media).toEqual([]);
    });
  });

  describe('还原', () => {
    it('整体替换：本机原有的内容不会与备份混在一起', async () => {
      await db.canvases.add({ id: '本机的', name: '还原前就有的', createdAt: 0, updatedAt: 0 });
      await db.nodes.add({ id: '本机节点', canvasId: '本机的', type: 'text', x: 0, y: 0 });

      await seed();
      const backup = await buildBackup('0.3.0', NOW);
      // 备份之后又改了本机数据，还原时这些改动应当被覆盖掉
      await db.nodes.add({ id: '备份之后新加的', canvasId: 'c1', type: 'text', x: 0, y: 0 });

      const summary = await restoreBackup(backup);

      expect(summary).toMatchObject({ canvases: 2, nodes: 3 });
      expect(await db.nodes.get('备份之后新加的')).toBeUndefined();
      expect(await db.nodes.get('n1')).toBeTruthy();
    });

    it('写回备份里的偏好键', async () => {
      const backup = await buildBackup('0.3.0', NOW);
      backup.settings = { app_theme: 'neo', app_language: 'en' };

      await restoreBackup(backup);

      expect(localStorage.getItem('app_theme')).toBe('neo');
      expect(localStorage.getItem('app_language')).toBe('en');
    });

    it('不碰备份里没有的键——还原别人的画布不该冲掉你自己的模型配置', async () => {
      localStorage.setItem('ai_config', '我自己的配置');
      const backup = await buildBackup('0.3.0', NOW);
      backup.settings = { app_theme: 'neo' };

      await restoreBackup(backup);

      expect(localStorage.getItem('ai_config')).toBe('我自己的配置');
    });

    it('导出再导入一轮，内容原样回来', async () => {
      await seed();
      const text = serializeBackup(await buildBackup('0.3.0', NOW));

      await db.nodes.clear();
      await db.canvases.clear();

      await restoreBackup(parseBackup(text)!);

      expect(await db.canvases.count()).toBe(1);
      expect((await db.nodes.get('n1'))?.content).toBe('甲');
      expect((await db.nodes.get('n2'))?.filePath).toBe('media/uploaded/a.png');
      expect(await db.edges.count()).toBe(1);
    });
  });
});
