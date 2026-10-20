import { describe, expect, it } from 'vitest';

function lum(hex: number): number {
  const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function ratio(a: number, b: number): number {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
}

describe('high contrast', () => {
  it('white and yellow text on black pass WCAG AAA (7:1)', () => {
    expect(ratio(0xffffff, 0x000000)).toBeGreaterThanOrEqual(7);
    expect(ratio(0xf5d742, 0x000000)).toBeGreaterThanOrEqual(7);
  });
});
