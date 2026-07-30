/**
 * Best-effort parsing for JSON emitted by LLMs (markdown fences, preamble,
 * trailing commas, extra prose around a single object/array).
 */

function extractBalanced(s: string, startIdx: number, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

export function extractFirstJsonFragment(s: string): string | null {
  const t = s.trim();
  const idx = t.search(/[\[{]/);
  if (idx === -1) return null;
  const open = t[idx] as '{' | '[';
  return extractBalanced(t, idx, open);
}

/** Removes trailing commas before `}` or `]` outside of JSON strings. */
export function removeTrailingCommas(json: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        out += c;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      const next = json[j];
      if (next === '}' || next === ']') {
        continue;
      }
    }
    out += c;
  }
  return out;
}

function stripCodeFences(raw: string): string {
  return raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
}

/**
 * Parse JSON from an LLM response; throws SyntaxError if nothing worked.
 */
export function parseLenientLlmJson(text: string): unknown {
  const stripped = stripCodeFences(text);
  const attempts: string[] = [stripped];
  const frag = extractFirstJsonFragment(stripped);
  if (frag && frag !== stripped) attempts.push(frag);

  for (const base of attempts) {
    const variants = [base, removeTrailingCommas(base)];
    for (const v of variants) {
      try {
        return JSON.parse(v);
      } catch {
        /* try next variant */
      }
    }
  }
  throw new SyntaxError('Could not parse JSON from LLM response');
}
