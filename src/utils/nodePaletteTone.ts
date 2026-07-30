/** Rough sRGB luminance for palette-driven chrome (dark cards vs light). */
export function isDarkNodeBackground(hex: string): boolean {
  const s = hex.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L < 0.42;
}
