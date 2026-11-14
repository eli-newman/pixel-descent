import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { Framebuffer, OFF, WHITE, YELLOW } from '../src/render/framebuffer';
import { drawTextHalo } from '../src/render/font';
import { hudRect } from '../src/render/layout';
import { SceneRenderer } from '../src/render/scene';
import { renderUi } from '../src/render/ui';
import { makeGame } from './helpers/fakes';

/** Rows `from` to `from + rows` of a framebuffer, as one array of packed colours. */
function rows(fb: Framebuffer, from: number, count: number): number[] {
  const out: number[] = [];
  for (let y = from; y < from + count; y++) for (let x = 0; x < W; x++) out.push(fb.get(x, y));
  return out;
}

describe('a phone filled edge to edge', () => {
  it('draws the slope above and below the frame, lined up with it to the pixel', () => {
    const offenders: string[] = [];
    let above = 0;
    let below = 0;
    {
      const { game, input } = makeGame('screen');
      input.push('start');
      game.update(1 / 120);
      expect(game.phase).toBe('playing');
      const frame = new SceneRenderer(new Framebuffer(W, H));
      const tall = new SceneRenderer(new Framebuffer(W, 30 + H + 45), 30);
      // Every quarter second of a 30 s run: nothing may pop in or out at the frame's edges either.
      for (let i = 0; i < 120 * 30 && game.phase === 'playing'; i++) {
        game.update(1 / 120);
        if (i % 30 !== 0) continue;
        const a = rows(frame.render(game), 0, H);
        const out = tall.render(game);
        const b = rows(out, 30, H);
        if (a.some((c, k) => c !== b[k])) offenders.push(`step ${i}`);
        // and the extra rows hold the slope (trees, flecks, the track), not an empty band
        if (new Set(rows(out, 0, 30)).size > 1) above++;
        if (new Set(rows(out, 30 + H, 45)).size > 1) below++;
      }
    }
    expect(offenders).toEqual([]);
    expect(above).toBeGreaterThan(20);
    expect(below).toBeGreaterThan(20);
  });

  it('carries the sky on above the start area on the title', () => {
    const { game } = makeGame('screen');
    game.update(1 / 120);
    const out = new SceneRenderer(new Framebuffer(W, 40 + H), 40).render(game);
    expect(new Set(rows(out, 0, 30))).toEqual(new Set([OFF]));
  });
});

describe('text without boxes', () => {
  it('outlines the letters instead of filling a box behind them', () => {
    const fb = new Framebuffer(20, 9);
    fb.clear(0);
    // T: a bar over a stem. A box would also fill the corners under the bar, beside the stem. The edge is drawn in
    // yellow here only so it can be told apart from the empty buffer.
    drawTextHalo(fb, 'T', 2, 2, WHITE, 1, YELLOW);
    expect(fb.get(1, 1)).toBe(YELLOW);
    expect(fb.get(2, 2)).toBe(WHITE);
    expect(fb.get(1, 7)).toBe(0);
    expect(fb.get(5, 7)).toBe(0);
  });

  it('leaves most of the score corner open to the slope while riding', () => {
    {
      const { game, input } = makeGame('screen');
      input.push('start');
      for (let i = 0; i < 120 * 3; i++) game.update(1 / 120);
      const fb = new Framebuffer(W, H);
      fb.clear(0);
      renderUi(fb, game);
      const r = hudRect(false);
      let covered = 0;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (fb.get(x, y) !== 0) covered++;
      // The old black block covered every pixel of it.
      expect(covered / (r.w * r.h)).toBeLessThan(0.6);
    }
  });
});
