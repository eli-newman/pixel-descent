import type { Framebuffer } from './framebuffer';
import { OFF, WHITE } from './framebuffer';

/** A tiny pixel font, five rows tall. Most glyphs are three columns wide; M, N and W are wider. */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
  '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'],
  ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'],
  '!': ['010', '010', '010', '000', '010'],
  '?': ['110', '001', '010', '000', '010'],
  '/': ['001', '001', '010', '100', '100'],
  '%': ['101', '001', '010', '100', '101'],
  "'": ['010', '010', '000', '000', '000'],
  '=': ['000', '111', '000', '111', '000'],
  '<': ['001', '010', '100', '010', '001'],
  '>': ['100', '010', '001', '010', '100'],
  '[': ['110', '100', '100', '100', '110'],
  ']': ['011', '001', '001', '001', '011'],
  '*': ['101', '010', '111', '010', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};

export const GLYPH_H = 5;

function glyphOf(ch: string): readonly string[] {
  return GLYPHS[ch] ?? GLYPHS['?'] ?? [];
}

function glyphWidth(ch: string): number {
  return glyphOf(ch)[0]?.length ?? 3;
}

/** Width in pixels of a string at an integer scale (one blank column between glyphs). */
export function textWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += (glyphWidth(ch) + 1) * scale;
  return Math.max(0, w - scale);
}

export function drawText(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  color: number = WHITE,
  scale = 1,
): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const rows = glyphOf(ch);
    const gw = glyphWidth(ch);
    for (let j = 0; j < GLYPH_H; j++) {
      const row = rows[j] ?? '';
      for (let i = 0; i < gw; i++) {
        if (row[i] === '1') fb.fillRect(cx + i * scale, y + j * scale, scale, scale, color);
      }
    }
    cx += (gw + 1) * scale;
  }
}

/** Draw text horizontally centred on x. */
export function drawTextCentered(
  fb: Framebuffer,
  text: string,
  cx: number,
  y: number,
  color: number = WHITE,
  scale = 1,
): void {
  drawText(fb, text, Math.round(cx - textWidth(text, scale) / 2), y, color, scale);
}

/** Text with a one pixel black halo, so it stays readable over trees and snow. */
export function drawTextHalo(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  color: number = WHITE,
  scale = 1,
): void {
  const w = textWidth(text, scale);
  fb.fillRect(x - 1, y - 1, w + 2, GLYPH_H * scale + 2, OFF);
  drawText(fb, text, x, y, color, scale);
}
