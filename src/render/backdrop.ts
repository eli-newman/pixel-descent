import { START_X, W } from '../config';
import { Rng } from '../rng';
import { Framebuffer, OFF, WHITE } from './framebuffer';

/** Height of the pre-rendered start area (peaks, foothills, gate), in world pixels. */
export const BACKDROP_H = 124;
const BASE = 106;

function drawPeaks(fb: Framebuffer): void {
  const rng = new Rng(7);
  const set = (x: number, y: number, on = true): void => fb.put(x, y, on ? WHITE : OFF);
  const jit = (y: number, c: number): number =>
    ((y * 37 + c * 11) % 5 === 0 ? 1 : 0) - ((y * 53 + c * 7) % 7 === 0 ? 1 : 0);
  const peak = (cx: number, top: number, hw: number, dim: boolean): void => {
    const edge = (y: number): number => Math.round((hw * (y - top)) / (BASE - top)) + jit(y, cx);
    for (let y = top; y <= BASE; y++) {
      const e = Math.max(0, edge(y));
      for (let x = cx - e - 1; x <= cx + e + 1; x++) set(x, y, false); // knock out whatever is behind
      for (let x = cx - e; x <= cx + e; x++) {
        const onEdge = x === cx - e || x === cx + e;
        const inCap = y < top + 11 + Math.abs(((x - cx) * 5) % 4) - (x > cx ? 2 : 0);
        if (onEdge)
          set(x, y); // outline
        else if (inCap)
          set(x, y); // snow cap (zig-zag lower edge)
        else if (x > cx && (x + y) % 4 === 0)
          set(x, y); // diagonal hatching on the shaded face
        else if (!dim && x < cx && (x - y + 999) % 9 === 0 && y > top + 14) set(x, y); // faint ridges on the lit face
      }
    }
  };
  // rolling foothills instead of a flat horizon
  for (let x = 4; x < W - 4; x++) {
    if (rng.next() > Math.min(1, Math.min(x, W - x) / 40)) continue;
    const y = BASE + 2 + Math.round(2 * Math.sin(x * 0.11) + 1.5 * Math.sin(x * 0.27));
    if ((x * 5) % 7 < 5) set(x, y);
  }
  const sx = (v: number): number => Math.round(v * 0.75);
  const sw = (v: number): number => Math.round(v * 0.8);
  // distant, then near
  for (const [c, t, w] of [
    [40, 64, 36],
    [204, 58, 32],
    [124, 74, 34],
  ] as const) {
    peak(sx(c), t, sw(w), true);
  }
  for (const [c, t, w] of [
    [46, 50, 44],
    [116, 24, 64],
    [188, 44, 46],
  ] as const) {
    peak(sx(c), t, sw(w), false);
  }
}

/** Start gate: two poles, a banner and a checkered strip. */
function drawGate(fb: Framebuffer, x: number, y: number): void {
  for (let j = 0; j < 18; j++) {
    fb.put(x - 14, y - j);
    fb.put(x + 14, y - j);
  }
  for (let i = -14; i <= 14; i++) {
    fb.put(x + i, y - 18);
    fb.put(x + i, y - 17);
  }
  for (let i = -12; i <= 12; i += 2) {
    for (let j = -16; j <= -12; j++) if ((i / 2 + j) % 2 === 0) fb.put(x + i, y + j);
  }
}

/** The peaks and start gate as a flat list of x,y pixel pairs in world space. */
export function buildBackdrop(): Int16Array {
  const fb = new Framebuffer(W, BACKDROP_H);
  drawPeaks(fb);
  drawGate(fb, START_X, 114);
  const out: number[] = [];
  for (let y = 0; y < BACKDROP_H; y++)
    for (let x = 0; x < W; x++) if (fb.isOn(x, y)) out.push(x, y);
  return Int16Array.from(out);
}
