import { describe, it, expect } from 'vitest';
import {
  looksLikeSamplingRejection,
  modelRejectsSampling,
} from '../../src/utils/samplingParams';

describe('modelRejectsSampling', () => {
  it('认 Kimi K2.5 起的型号', () => {
    expect(modelRejectsSampling('kimi-k2.5')).toBe(true);
    expect(modelRejectsSampling('kimi-k2.6')).toBe(true);
    expect(modelRejectsSampling('kimi-k3')).toBe(true);
    expect(modelRejectsSampling('kimi-k2-thinking')).toBe(true);
  });

  it('不误伤仍然接受采样参数的 Kimi 旧型号', () => {
    expect(modelRejectsSampling('kimi-k2')).toBe(false);
    expect(modelRejectsSampling('kimi-k1.5')).toBe(false);
    expect(modelRejectsSampling('moonshot-v1-8k')).toBe(false);
  });

  it('认 OpenAI 的推理系列与 GPT-5 族', () => {
    expect(modelRejectsSampling('o1')).toBe(true);
    expect(modelRejectsSampling('o3-mini')).toBe(true);
    expect(modelRejectsSampling('gpt-5-codex')).toBe(true);
  });

  it('不误伤 gpt-4o —— 它接受采样参数', () => {
    expect(modelRejectsSampling('gpt-4o')).toBe(false);
    expect(modelRejectsSampling('gpt-4o-mini')).toBe(false);
  });

  it('网关的 `厂商/模型` 写法按最后一段判断', () => {
    expect(modelRejectsSampling('moonshotai/kimi-k2.5')).toBe(true);
    expect(modelRejectsSampling('openai/gpt-4o')).toBe(false);
  });

  it('空值与空白不算', () => {
    expect(modelRejectsSampling('')).toBe(false);
    expect(modelRejectsSampling('   ')).toBe(false);
  });
});

describe('looksLikeSamplingRejection', () => {
  it('认出 Moonshot 那条报错', () => {
    expect(
      looksLikeSamplingRejection(
        '{"error":{"message":"invalid temperature: only 1 is allowed for this model"}}',
      ),
    ).toBe(true);
  });

  it('认出 OpenAI 那条报错与 top_p 的各种写法', () => {
    expect(looksLikeSamplingRejection("Unsupported value: 'temperature'")).toBe(true);
    expect(looksLikeSamplingRejection('top_p is not supported')).toBe(true);
    expect(looksLikeSamplingRejection('top-p out of range')).toBe(true);
  });

  it('不把鉴权、额度之类的报错认成采样参数问题', () => {
    expect(looksLikeSamplingRejection('Incorrect API key provided')).toBe(false);
    expect(looksLikeSamplingRejection('insufficient_quota')).toBe(false);
    expect(looksLikeSamplingRejection(undefined)).toBe(false);
    expect(looksLikeSamplingRejection('')).toBe(false);
  });
});
