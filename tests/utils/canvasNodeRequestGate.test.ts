import { describe, it, expect } from 'vitest';
import { looksLikeCanvasNodeRequest } from '../../src/utils/canvasNodeRequestGate';

describe('looksLikeCanvasNodeRequest', () => {
  it('空白输入不放行', () => {
    expect(looksLikeCanvasNodeRequest('')).toBe(false);
    expect(looksLikeCanvasNodeRequest('   \n ')).toBe(false);
  });

  describe('中文：动词 + 名词才放行', () => {
    it.each([
      '建三个便签，分别写早中晚的安排',
      '新建一张主题卡叫「叙事结构」',
      '帮我加两个笔记',
      '把这段整理成便签',
      '拆成几张卡片',
      '生成 5 个节点',
      '写成便利贴',
    ])('放行：%s', (text) => {
      expect(looksLikeCanvasNodeRequest(text)).toBe(true);
    });

    it.each([
      '帮我解释一下量子纠缠',
      '这段话怎么改更顺',
      '总结一下上面选中的内容',
      '写一篇关于城市记忆的短文',
    ])('拦截：%s', (text) => {
      expect(looksLikeCanvasNodeRequest(text)).toBe(false);
    });

    it('只有名词没有动词不放行', () => {
      expect(looksLikeCanvasNodeRequest('便签')).toBe(false);
      expect(looksLikeCanvasNodeRequest('主题卡是什么意思')).toBe(false);
    });

    it('只有动词没有名词不放行', () => {
      expect(looksLikeCanvasNodeRequest('帮我生成一段引言')).toBe(false);
    });
  });

  describe('英文', () => {
    it.each([
      'create three notes about onboarding',
      'add a card for the Q3 goals',
      'turn this into notes',
      'make two sticky notes',
    ])('放行：%s', (text) => {
      expect(looksLikeCanvasNodeRequest(text)).toBe(true);
    });

    it.each([
      'explain quantum entanglement',
      'summarize the selected material',
      'what does this note mean',
    ])('拦截：%s', (text) => {
      expect(looksLikeCanvasNodeRequest(text)).toBe(false);
    });

    it('词界生效：denote / another 不算 note', () => {
      expect(looksLikeCanvasNodeRequest('create a denote helper')).toBe(false);
    });
  });

  it('误放行由规划器兜底，所以问句形式也可能放行', () => {
    // 这里断言的是当前取舍：粗筛不判断问句，交给规划器返回 answer
    expect(looksLikeCanvasNodeRequest('便签怎么建？')).toBe(true);
  });
});
