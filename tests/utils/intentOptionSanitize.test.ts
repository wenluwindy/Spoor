import { describe, it, expect } from 'vitest';
import {
  intentOptionLooksAssistantDirected,
  intentOptionLooksUserRewrite,
  intentOptionsAreInvalidClarification,
} from '../../src/utils/intentOptionSanitize';

describe('intentOptionSanitize', () => {
  it('flags assistant-directed Chinese options', () => {
    expect(intentOptionLooksAssistantDirected('安慰用户并表达理解。')).toBe(true);
    expect(intentOptionLooksAssistantDirected('询问用户苦恼的具体原因并提供建议。')).toBe(true);
  });

  it('flags first-person user rewrites', () => {
    expect(intentOptionLooksUserRewrite('我最近心里烦，想跟你聊聊是什么事。')).toBe(true);
    expect(intentOptionLooksUserRewrite('我想把现在的感受写下来。')).toBe(true);
  });

  it('accepts clarifying questions to the user', () => {
    expect(intentOptionLooksAssistantDirected('你遇到了什么事情？')).toBe(false);
    expect(intentOptionLooksUserRewrite('你是想寻求解决苦恼的方法吗？')).toBe(false);
    expect(intentOptionLooksUserRewrite('你主要是想倾诉情绪，还是想把感受写成文字？')).toBe(
      false,
    );
  });

  it('treats a set as invalid when at least two are wrong format', () => {
    expect(
      intentOptionsAreInvalidClarification([
        '安慰用户并表达理解。',
        '询问用户苦恼的具体原因并提供建议。',
        '你遇到了什么事情？',
      ]),
    ).toBe(true);
  });
});
