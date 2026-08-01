import { describe, it, expect } from 'vitest';
import { buildResearchFrame } from '../../src/services/researchToCanvas';

function sequentialIds() {
  let n = 0;
  return () => `id-${++n}`;
}

const SESSION = {
  query: 'AI 如何改变独立创作者',
  researchPlan: [
    { title: '现状', desc: '先看今天的工具链' },
    { title: '变量', desc: '再看哪些环节会被替代' },
  ],
  researchReport: {
    intro: '这篇研究讨论……',
    points: [
      { title: '论点一', text: '正文一' },
      { title: '论点二', text: '正文二' },
    ],
    conclusion: '综上所述……',
  },
};

const OPTIONS = {
  canvasId: 'c1',
  at: { x: 100, y: 200 },
  session: SESSION,
  frameLabel: '研究：AI 如何改变独立创作者',
  planLabel: '步骤',
  conclusionLabel: '结论',
};

describe('researchToCanvas', () => {
  it('框排在最前——数组顺序即 z 序，框必须在卡片下面', () => {
    const { nodes } = buildResearchFrame({ ...OPTIONS, newId: sequentialIds() });
    expect(nodes[0].type).toBe('frame');
    expect(nodes[0].content).toBe('研究：AI 如何改变独立创作者');
  });

  it('题目成主题卡，正文用研究导语', () => {
    const { nodes } = buildResearchFrame({ ...OPTIONS, newId: sequentialIds() });
    const topic = nodes.find((n) => n.type === 'theme')!;
    expect(topic.content).toBe(SESSION.query);
    expect(topic.description).toBe(SESSION.researchReport.intro);
  });

  it('计划、论点、结论各成一张卡', () => {
    const { nodes } = buildResearchFrame({ ...OPTIONS, newId: sequentialIds() });
    const texts = nodes.filter((n) => n.type === 'text').map((n) => n.content ?? '');
    expect(texts).toHaveLength(2 + 2 + 1);
    expect(texts[0]).toContain('步骤 1 · 现状');
    expect(texts[2]).toContain('论点一');
    expect(texts[4]).toContain('结论');
  });

  it('全部连回题目卡', () => {
    const { nodes, edges } = buildResearchFrame({ ...OPTIONS, newId: sequentialIds() });
    const topicId = nodes.find((n) => n.type === 'theme')!.id;
    expect(edges).toHaveLength(5);
    expect(edges.every((e) => e.from === topicId)).toBe(true);
  });

  it('没有结论时不硬造一张空卡', () => {
    const { nodes } = buildResearchFrame({
      ...OPTIONS,
      session: { ...SESSION, researchReport: { ...SESSION.researchReport, conclusion: '   ' } },
      newId: sequentialIds(),
    });
    expect(nodes.filter((n) => n.type === 'text')).toHaveLength(4);
  });

  it('计划与论点都为空时仍然出一个框加一张题目卡', () => {
    const { nodes, edges } = buildResearchFrame({
      ...OPTIONS,
      session: {
        query: '空研究',
        researchPlan: [],
        researchReport: { intro: '', points: [], conclusion: '' },
      },
      newId: sequentialIds(),
    });
    expect(nodes.map((n) => n.type)).toEqual(['frame', 'theme']);
    expect(edges).toEqual([]);
  });

  it('框把所有卡片包在里面', () => {
    const { nodes } = buildResearchFrame({ ...OPTIONS, newId: sequentialIds() });
    const [frame, ...cards] = nodes;
    const frameRight = frame.x + frame.width!;
    const frameBottom = frame.y + frame.height!;

    for (const card of cards) {
      expect(card.x).toBeGreaterThanOrEqual(frame.x);
      expect(card.y).toBeGreaterThanOrEqual(frame.y);
      expect(card.x + (card.width ?? 0)).toBeLessThanOrEqual(frameRight);
      expect(card.y).toBeLessThanOrEqual(frameBottom);
    }
  });

  it('落点决定框的左上角', () => {
    const { nodes } = buildResearchFrame({
      ...OPTIONS,
      at: { x: -500, y: 42 },
      newId: sequentialIds(),
    });
    expect(nodes[0]).toMatchObject({ x: -500, y: 42 });
  });

  it('所有行都归到目标画布', () => {
    const { nodes, edges } = buildResearchFrame({
      ...OPTIONS,
      canvasId: 'other',
      newId: sequentialIds(),
    });
    expect(nodes.every((n) => n.canvasId === 'other')).toBe(true);
    expect(edges.every((e) => e.canvasId === 'other')).toBe(true);
  });
});
