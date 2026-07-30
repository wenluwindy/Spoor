/**
 * 从模型回复里抠出第一个 JSON 对象。
 *
 * 即使提示词里写了「只输出 JSON」，模型仍常见地包一层 ```json 围栏，
 * 或在前后加一句解释。这里按「围栏 → 整串 → 首个 `{` 到末个 `}`」逐级降级。
 *
 * 解析不出来时抛 `Error('json_object')`，由调用方决定降级策略。
 */
export function extractFirstJsonObject(raw: string): unknown {
  const text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(text);
  const body = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error('json_object');
  }
}
