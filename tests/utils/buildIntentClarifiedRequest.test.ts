import { describe, it, expect } from 'vitest';
import { buildIntentClarifiedRequest } from '../../src/utils/buildIntentClarifiedRequest';

describe('buildIntentClarifiedRequest', () => {
  const labels = {
    selectedIntro: '请围绕以下我勾选的方向回应（可多选）：',
    extraSection: '补充说明',
  };

  it('merges original with multi-selected clarifying questions', () => {
    const out = buildIntentClarifiedRequest(
      '我很苦恼',
      ['你遇到了什么事情？', '你是想寻求解决苦恼的方法吗？'],
      undefined,
      labels,
    );
    expect(out).toContain('我很苦恼');
    expect(out).toContain(labels.selectedIntro);
    expect(out).toContain('- 你遇到了什么事情？');
    expect(out).toContain('- 你是想寻求解决苦恼的方法吗？');
  });

  it('appends extra notes when provided', () => {
    const out = buildIntentClarifiedRequest('我很苦恼', ['你遇到了什么事情？'], '最近工作压力大', labels);
    expect(out).toContain('补充说明：最近工作压力大');
  });
});
