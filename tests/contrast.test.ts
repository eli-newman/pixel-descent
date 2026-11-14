import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { Framebuffer, GREY, OFF, SOFT_GREY, WHITE, YELLOW } from '../src/render/framebuffer';
import { SceneRenderer } from '../src/render/scene';
import { renderUi } from '../src/render/ui';
import { makeGame } from './helpers/fakes';

/** The [r, g, b] bytes a packed framebuffer colour puts on screen. */
function rgb(color: number): number[] {
  const fb = new Framebuffer(1, 1);
  fb.clear(color);
  return [...fb.data.slice(0, 3)];
}

function lum(c: number[]): number {
  const ch = c.map((v) => {
    const k = v / 255;
    return k <= 0.03928 ? k / 12.92 : Math.pow((k + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function ratio(a: number[], b: number[]): number {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
}

describe('high contrast', () => {
  it('white and yellow on the black background pass WCAG AAA (7:1)', () => {
    expect(ratio(rgb(WHITE), rgb(OFF))).toBeGreaterThanOrEqual(7);
    expect(ratio(rgb(YELLOW), rgb(OFF))).toBeGreaterThanOrEqual(7);
  });

  it('the track shadow stays visible on black but well below white, so it never reads as the line', () => {
    expect(ratio(rgb(GREY), rgb(OFF))).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb(WHITE), rgb(GREY))).toBeGreaterThanOrEqual(3);
    // Inside a side slip it sits on white, so it has to stay visible there without looking harsh.
    expect(ratio(rgb(WHITE), rgb(SOFT_GREY))).toBeGreaterThanOrEqual(2);
    expect(ratio(rgb(WHITE), rgb(SOFT_GREY))).toBeLessThan(ratio(rgb(WHITE), rgb(GREY)));
  });

  it('uses the same yellow on the canvas and in the page', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const hex = /--yellow:\s*#([0-9a-f]{6})/i.exec(css)?.[1];
    expect(hex).toBeDefined();
    const page = [0, 2, 4].map((i) => parseInt((hex ?? '').slice(i, i + 2), 16));
    expect(page).toEqual(rgb(YELLOW));
  });

  it('draws real screens with nothing outside the palette', () => {
    const { game, input } = makeGame('palette');
    const scene = new SceneRenderer(new Framebuffer(W, H));
    const check = (colors: readonly number[]): void => {
      const palette = new Set(colors.map((c) => rgb(c).join()));
      const out = scene.render(game);
      renderUi(out, game);
      // One expect per screen: expect is far too slow per pixel.
      const stray = new Set<string>();
      for (let i = 0; i < out.data.length; i += 4) {
        const c = `${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`;
        if (!palette.has(c)) stray.add(c);
      }
      expect([...stray]).toEqual([]);
    };
    game.update(1 / 120);
    check([OFF, WHITE, YELLOW]);
    input.push('start');
    for (let i = 0; i < 480; i++) game.update(1 / 120);
    check([OFF, WHITE, YELLOW, GREY, SOFT_GREY]);
    for (let i = 0; i < 120 * 300 && game.phase !== 'over'; i++) game.update(1 / 120);
    expect(game.phase).toBe('over');
    check([OFF, WHITE, YELLOW, GREY, SOFT_GREY]);
  });
});
