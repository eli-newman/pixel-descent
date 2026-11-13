import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { Framebuffer } from '../src/render/framebuffer';
import { C, MONO } from '../src/render/palette';
import { WIPEOUT_SETTLE, wipeoutHead } from '../src/render/riderSprite';
import { renderUi } from '../src/render/ui';
import type { Game } from '../src/state/game';
import { makeGame } from './helpers/fakes';

const STEP = 1 / 120;

/** Ride straight down a course until the rider crashes. */
function crashed(color: boolean): Game {
  const { game, input } = makeGame('zq7secret42');
  if (color) game.press('color');
  input.push('start');
  for (let i = 0; i < 120 * 60 && !game.sim.crashed; i++) game.update(STEP);
  expect(game.sim.crashed).toBe(true);
  return game;
}

/** Where the bird colour shows in the HUD layer. */
function birdPixels(game: Game, bird: number): Array<[number, number]> {
  const fb = new Framebuffer(W, H);
  fb.clear(0);
  renderUi(fb, game);
  const out: Array<[number, number]> = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (fb.get(x, y) === bird) out.push([x, y]);
  return out;
}

describe('birds over a fallen rider', () => {
  it('circle his head once the tumble is over, flapping, until the next run, in both looks', () => {
    for (const color of [false, true]) {
      const game = crashed(color);
      const bird = color ? C.bird : MONO.bird;
      // none while he is still tumbling (in black and white the score is white too, so look only near him)
      const near = (pts: Array<[number, number]>): Array<[number, number]> => {
        const head = wipeoutHead(
          Math.round(game.riderX),
          Math.round(game.riderY - game.camYi) + 10,
          game.sim.crashFace,
        );
        return pts.filter(
          ([x, y]) => Math.abs(x - head.x) <= 14 && y >= head.y - 14 && y <= head.y,
        );
      };
      expect(near(birdPixels(game, bird))).toEqual([]);
      while (game.sim.crashT < WIPEOUT_SETTLE) game.update(STEP);
      const first = near(birdPixels(game, bird));
      // three birds of five pixels each, give or take one hidden behind another
      expect(first.length).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < 12; i++) game.update(STEP);
      const later = near(birdPixels(game, bird));
      expect(later.length).toBeGreaterThanOrEqual(10);
      expect(later).not.toEqual(first);
      // still there on the game over screen, and gone on the next run
      for (let i = 0; i < 120 * 5 && game.phase !== 'over'; i++) game.update(STEP);
      expect(game.phase).toBe('over');
      expect(near(birdPixels(game, bird)).length).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < 120; i++) game.update(STEP);
      game.press('again');
      game.update(STEP);
      expect(game.sim.crashed).toBe(false);
      expect(near(birdPixels(game, bird))).toEqual([]);
    }
  });
});
