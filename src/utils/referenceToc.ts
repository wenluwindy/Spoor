export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'section';
}

export function extractToc(content: string): { level: number; text: string; slug: string }[] {
  const out: { level: number; text: string; slug: string }[] = [];
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      const text = m[2].trim();
      out.push({ level: m[1].length, text, slug: slugifyHeading(text) });
    }
  }
  return out;
}
