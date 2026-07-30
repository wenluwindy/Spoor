import { describe, expect, it } from 'vitest';
import { parseLenientLlmJson, removeTrailingCommas } from './llmJson';

describe('llmJson', () => {
  it('removeTrailingCommas fixes commas before } and ]', () => {
    expect(removeTrailingCommas('{"a":[1,2,],}')).toBe('{"a":[1,2]}');
  });

  it('parseLenientLlmJson handles markdown fences and trailing commas', () => {
    const raw = `Sure — here's the JSON:
\`\`\`json
{
  "intro": "hi",
  "points": [{"title": "t", "text": "body"},],
  "conclusion": "bye",
}
\`\`\``;
    expect(parseLenientLlmJson(raw)).toEqual({
      intro: 'hi',
      points: [{ title: 't', text: 'body' }],
      conclusion: 'bye',
    });
  });

  it('parseLenientLlmJson extracts first object when wrapped in text', () => {
    const raw = 'Prefix noise {"x":1} trailing';
    expect(parseLenientLlmJson(raw)).toEqual({ x: 1 });
  });
});
