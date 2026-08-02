import { describe, it, expect } from 'vitest';
import { buildResearchStepCards } from '../../src/services/researchStepToCanvas';

function sequentialIds() {
  let n = 0;
  return () => `id-${++n}`;
}

const STEP = {
  title: '现状：AI 工具链走到了哪一步',
  analysis: '这一步的核心判断是……（分析全文）',
  sources: [
    { title: 'Source A', link: 'https://a.example.com/post', snippet: '摘要 A' },
    { title: 'Source B', link: 'https://b.example.com', snippet: '摘要 B' },
    { title: '无链接来源', link: '', snippet: '不该落卡' },
    { title: '协议不对', link: 'ftp://c.example.com', snippet: '也不该落卡' },
  ],
};

const OPTIONS = {
  canvasId: 'c1',
  at: { x: 100, y: 200 },
  step: STEP,
};

describe('researchStepToCanvas', () => {
  it('步骤成主题卡：标题=步骤标题，描述=该步分析全文，落在落点', () => {
    const { nodes } = buildResearchStepCards({ ...OPTIONS, newId: sequentialIds() });
    const theme = nodes[0];
    expect(theme.type).toBe('theme');
    expect(theme.content).toBe(STEP.title);
    expect(theme.description).toBe(STEP.analysis);
    expect(theme).toMatchObject({ x: 100, y: 200 });
  });

  it('只有带 http(s) 链接的来源落成 web 卡', () => {
    const { nodes } = buildResearchStepCards({ ...OPTIONS, newId: sequentialIds() });
    const webs = nodes.filter((n) => n.type === 'web');
    expect(webs).toHaveLength(2);
    expect(webs.map((n) => n.url)).toEqual(['https://a.example.com/post', 'https://b.example.com']);
  });

  it('web 卡形态与搜索落卡一致：标题/摘要来自快照，站点名从链接解析', () => {
    const { nodes } = buildResearchStepCards({ ...OPTIONS, newId: sequentialIds() });
    const web = nodes.find((n) => n.type === 'web')!;
    expect(web.urlTitle).toBe('Source A');
    expect(web.urlExcerpt).toBe('摘要 A');
    expect(web.urlSiteName).toBe('a.example.com');
    expect(web.width).toBe(320);
  });

  it('空白标题与摘要不写成空字符串字段', () => {
    const { nodes } = buildResearchStepCards({
      ...OPTIONS,
      step: {
        ...STEP,
        sources: [{ title: '  ', link: 'https://x.example.com', snippet: '' }],
      },
      newId: sequentialIds(),
    });
    const web = nodes.find((n) => n.type === 'web')!;
    expect(web.urlTitle).toBeUndefined();
    expect(web.urlExcerpt).toBeUndefined();
  });

  it('来源卡全部连回主题卡', () => {
    const { nodes, edges } = buildResearchStepCards({ ...OPTIONS, newId: sequentialIds() });
    const themeId = nodes[0].id;
    const webIds = nodes.filter((n) => n.type === 'web').map((n) => n.id);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.from === themeId)).toBe(true);
    expect(edges.map((e) => e.to)).toEqual(webIds);
  });

  it('没有可落的来源时只落一张主题卡、没有连线', () => {
    const { nodes, edges } = buildResearchStepCards({
      ...OPTIONS,
      step: { ...STEP, sources: [] },
      newId: sequentialIds(),
    });
    expect(nodes.map((n) => n.type)).toEqual(['theme']);
    expect(edges).toEqual([]);
  });

  it('来源列每列三张、之后另起一列，布局是确定性的', () => {
    const manySources = Array.from({ length: 5 }, (_, i) => ({
      title: `S${i}`,
      link: `https://s${i}.example.com`,
      snippet: '',
    }));
    const { nodes } = buildResearchStepCards({
      ...OPTIONS,
      step: { ...STEP, sources: manySources },
      newId: sequentialIds(),
    });
    const webs = nodes.filter((n) => n.type === 'web');
    // 前三张同一列（x 相同、y 递增），第四张另起一列回到首行
    expect(webs[0].x).toBe(webs[1].x);
    expect(webs[1].x).toBe(webs[2].x);
    expect(webs[1].y).toBeGreaterThan(webs[0].y);
    expect(webs[3].x).toBeGreaterThan(webs[0].x);
    expect(webs[3].y).toBe(webs[0].y);
    // 来源列在主题卡右侧
    expect(webs[0].x).toBeGreaterThan(nodes[0].x + (nodes[0].width ?? 0));
  });

  it('所有行都归到目标画布', () => {
    const { nodes, edges } = buildResearchStepCards({
      ...OPTIONS,
      canvasId: 'other',
      newId: sequentialIds(),
    });
    expect(nodes.every((n) => n.canvasId === 'other')).toBe(true);
    expect(edges.every((e) => e.canvasId === 'other')).toBe(true);
  });
});
