import { describe, it, expect } from 'vitest';
import { extractToc, slugifyHeading } from '../../src/utils/referenceToc';

describe('referenceToc', () => {
  it('extractToc 按行识别 # 标题并生成 slug', () => {
    const toc = extractToc('# 主标题\n\n## 第一节\n\n段落\n\n### 小节');
    expect(toc).toEqual([
      { level: 1, text: '主标题', slug: slugifyHeading('主标题') },
      { level: 2, text: '第一节', slug: slugifyHeading('第一节') },
      { level: 3, text: '小节', slug: slugifyHeading('小节') },
    ]);
  });
});
