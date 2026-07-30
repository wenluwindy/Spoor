import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_DOC_LINKS,
  CUSTOM_ENDPOINT_DOC_LINKS,
  DEEPSEEK_DOC_LINKS,
  GEMINI_DOC_LINKS,
  METASO_DOC_LINKS,
  DOUBAO_DOC_LINKS,
  MIMO_DOC_LINKS,
  OPENAI_DOC_LINKS,
  type DocLink,
} from '../../src/constants/aiProviderDocs';

function assertDocLinks(links: DocLink[], name: string) {
  expect(links.length, `${name} should not be empty`).toBeGreaterThan(0);
  const hrefs = links.map((l) => l.href);
  expect(new Set(hrefs).size, `${name} hrefs must be unique`).toBe(hrefs.length);
  for (const link of links) {
    expect(link.href, `${name} href`).toMatch(/^https:\/\//);
    expect(link.labelKey, `${name} labelKey`).toMatch(/^settings\.docs_/);
  }
}

describe('aiProviderDocs', () => {
  it('Gemini 文档链接完整且指向 https', () => {
    assertDocLinks(GEMINI_DOC_LINKS, 'GEMINI');
    expect(GEMINI_DOC_LINKS.some((l) => l.href.includes('aistudio.google.com'))).toBe(true);
  });

  it('OpenAI 文档链接使用当前有效的 /api/docs 路径', () => {
    assertDocLinks(OPENAI_DOC_LINKS, 'OPENAI');
    expect(OPENAI_DOC_LINKS.every((l) => !l.href.includes('/docs/quickstart'))).toBe(true);
    expect(OPENAI_DOC_LINKS.some((l) => l.href.includes('platform.openai.com/api-keys'))).toBe(true);
  });

  it('Anthropic 与 MiMo 文档链接非空', () => {
    assertDocLinks(ANTHROPIC_DOC_LINKS, 'ANTHROPIC');
    assertDocLinks(MIMO_DOC_LINKS, 'MIMO');
    expect(MIMO_DOC_LINKS.some((l) => l.href.includes('xiaomimimo'))).toBe(true);
  });

  it('Doubao 文档链接非空且指向火山方舟', () => {
    assertDocLinks(DOUBAO_DOC_LINKS, 'DOUBAO');
    expect(DOUBAO_DOC_LINKS.some((l) => l.href.includes('volcengine'))).toBe(true);
  });

  it('DeepSeek 文档链接非空且指向官方平台', () => {
    assertDocLinks(DEEPSEEK_DOC_LINKS, 'DEEPSEEK');
    expect(DEEPSEEK_DOC_LINKS.some((l) => l.href.includes('deepseek.com'))).toBe(true);
  });

  it('Custom 端点与 Metaso 文档链接非空', () => {
    assertDocLinks(CUSTOM_ENDPOINT_DOC_LINKS, 'CUSTOM');
    assertDocLinks(METASO_DOC_LINKS, 'METASO');
    expect(METASO_DOC_LINKS.some((l) => l.href.includes('metaso.cn'))).toBe(true);
  });
});
