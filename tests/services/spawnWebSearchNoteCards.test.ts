import { beforeEach, describe, it, expect } from 'vitest';
import { db } from '../../src/db';
import {
  deriveSearchQueryFromNoteText,
  spawnWebSearchCardsFromPages,
} from '../../src/services/spawnWebSearchNoteCards';

describe('spawnWebSearchCardsFromPages', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('带链接的结果落成 web 卡（保留来源），没链接的退回 text 卡', async () => {
    await spawnWebSearchCardsFromPages(
      'src-note',
      { x: 0, y: 0 },
      [
        { title: '一篇文章', snippet: '摘要内容', link: 'https://example.com/a', score: '1', date: '' },
        { title: '无来源条目', snippet: '只有文字', link: '', score: '0.5', date: '' },
      ],
      'c1',
      { staggerMs: 0 },
    );

    const nodes = await db.nodes.toArray();
    const web = nodes.find((n) => n.type === 'web');
    expect(web).toMatchObject({
      url: 'https://example.com/a',
      urlTitle: '一篇文章',
      urlExcerpt: '摘要内容',
    });
    const text = nodes.find((n) => n.type === 'text');
    expect(text?.content).toContain('无来源条目');

    // 每张都连回源便签
    const edges = await db.edges.toArray();
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.from === 'src-note')).toBe(true);
  });
});

describe('deriveSearchQueryFromNoteText', () => {
  it('returns empty for blank', () => {
    expect(deriveSearchQueryFromNoteText('')).toBe('');
    expect(deriveSearchQueryFromNoteText('  \n  ')).toBe('');
  });

  it('uses first non-empty line', () => {
    expect(deriveSearchQueryFromNoteText('\nfoo\nbar')).toBe('foo');
  });

  it('truncates long first line', () => {
    const long = 'a'.repeat(400);
    expect(deriveSearchQueryFromNoteText(long, 280)).toHaveLength(280);
  });
});
