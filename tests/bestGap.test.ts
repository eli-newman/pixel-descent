import { describe, expect, it } from 'vitest';
import { PX_PER_M, START_Y, W } from '../src/core/config';
import type { Dare } from '../src/core/dare';
import { dailySeed } from '../src/core/rng';
import { Framebuffer, YELLOW } from '../src/render/framebuffer';
import { SceneRenderer } from '../src/render/scene';
import { bestLine } from '../src/render/ui';
import type { Game } from '../src/state/game';
import { bestMark, createProgress } from '../src/state/progress';
import { ALL_LESSONS } from '../src/state/tutorial';
import { makeGame, stepUntil, type Rig } from './helpers/fakes';

/** Ride a run to its game over screen. */
function ride(rig: Rig): Game {
  const { game, input } = rig;
  input.push('start');
  stepUntil(game, () => game.phase === 'over');
  stepUntil(game, () => game.overReady);
  return game;
}

/** The game over line under the score, as the screen shows it. */
function overLine(game: Game): ReturnType<typeof bestLine> {
  const res = game.result;
  if (!res) throw new Error('no result');
  return bestLine(res, game.overallBest, game.dare !== null);
}

describe('how close a run came to the best', () => {
  it('names a new best in yellow', () => {
    expect(bestLine({ score: 900, newBest: true }, 900, false)).toEqual({
      text: 'NEW BEST!',
      hot: true,
    });
    // a new best on a dare is still a new best
    expect(bestLine({ score: 900, newBest: true }, 900, true)?.text).toBe('NEW BEST!');
  });

  it('says how far short, in score, which is what the boards rank by', () => {
    expect(bestLine({ score: 1200, newBest: false }, 1240, false)).toEqual({
      text: '40 SHORT OF YOUR BEST',
      hot: false,
    });
    expect(bestLine({ score: 0, newBest: false }, 1240, false)?.text).toBe(
      '1240 SHORT OF YOUR BEST',
    );
  });

  it('counts a run equal to the best as a tie, not a new best', () => {
    expect(bestLine({ score: 1240, newBest: false }, 1240, false)).toEqual({
      text: 'TIED YOUR BEST',
      hot: true,
    });
  });

  it('says nothing before there is any best', () => {
    expect(bestLine({ score: 0, newBest: false }, 0, false)).toBeNull();
    expect(bestLine({ score: 0, newBest: false }, 0, true)).toBeNull();
  });

  it("leaves the gap to the friend's score on a dare, and just names the best", () => {
    expect(bestLine({ score: 1200, newBest: false }, 1240, true)).toEqual({
      text: 'BEST 1240',
      hot: false,
    });
  });

  it('measures a daily run against the all-time best too, as the HUD does', () => {
    const rig = makeGame(dailySeed(new Date(2026, 9, 20, 12)));
    rig.store.recordRun('other', { score: 99999, dist: 9000, date: '2026-10-19' });
    const game = ride(rig);
    expect(game.daily).toBe(true);
    const score = game.result?.score ?? 0;
    expect(overLine(game)?.text).toBe(`${99999 - score} SHORT OF YOUR BEST`);
  });

  it('shows on a real second run that falls short, and a new best on the first', () => {
    const rig = makeGame('gap1');
    const first = ride(rig);
    expect(overLine(first)?.text).toBe('NEW BEST!');
    // A run on the same course with no input ends the same, so it ties.
    first.press('retry');
    const again = ride(rig);
    expect(overLine(again)?.text).toBe('TIED YOUR BEST');
  });

  it('names the best on a dare run, never two SHORT OF lines', () => {
    const dare: Dare = {
      seed: 'k3m9qa',
      score: 9_999_999,
      dist: 312,
      stars: 4,
      tricks: 3,
      end: 'tree',
      skis: false,
      board: 0,
      rider: 0,
    };
    const rig = makeGame('x', {}, undefined, { dare });
    rig.store.recordRun('other', { score: 99999, dist: 9000, date: '2026-10-19' });
    const game = ride(rig);
    expect(overLine(game)?.text).toBe('BEST 99999');
  });
});

describe('the best distance mark on the slope', () => {
  it('needs a run behind the player and some distance', () => {
    const p = createProgress();
    expect(bestMark(p.stats)).toBeNull();
    p.stats.runs = 1;
    expect(bestMark(p.stats)).toBeNull();
    p.stats.bestDist = 312;
    expect(bestMark(p.stats)).toBe(312);
  });

  it('is never there on the first run, then holds the furthest run before this one', () => {
    const rig = makeGame('mark1');
    const { game } = rig;
    expect(game.bestMarkM).toBeNull();
    ride(rig);
    // Still none under the first run's game over screen, though its distance is now saved.
    expect(game.bestMarkM).toBeNull();
    const dist = game.result?.dist ?? 0;
    expect(dist).toBeGreaterThan(0);
    game.press('again');
    expect(game.bestMarkM).toBe(dist);
    // A run further than the best does not move the mark under it.
    rig.store.progress().stats.bestDist = dist + 500;
    expect(game.bestMarkM).toBe(dist);
  });

  it('stays off the slope while the tutorial still has lessons to show', () => {
    const rig = makeGame('mark3', {}, undefined, { tutorial: true });
    const p = rig.store.progress();
    p.stats.runs = 1;
    p.stats.bestDist = 28;
    rig.game.newRun(rig.game.freshSeed());
    expect(rig.game.bestMarkM).toBeNull();
    p.stats.lessons = ALL_LESSONS;
    rig.game.newRun(rig.game.freshSeed());
    expect(rig.game.bestMarkM).toBe(28);
  });

  it('is drawn across the slope at the row where that distance is reached, with yellow ticks at the edges', () => {
    const rig = makeGame('mark2');
    const { game, input, store } = rig;
    const p = store.progress();
    p.stats.runs = 4;
    p.stats.bestDist = 20;
    game.newRun('mark2');
    expect(game.bestMarkM).toBe(20);
    const fb = new Framebuffer(W, 320);
    const scene = new SceneRenderer(fb);
    // Not on the title screen.
    scene.render(game);
    const row = START_Y + 20 * PX_PER_M - game.camYi;
    expect(fb.get(1, row)).not.toBe(YELLOW);
    input.push('start');
    game.update(1 / 120);
    scene.render(game);
    const y = START_Y + 20 * PX_PER_M - game.camYi;
    expect(fb.get(1, y)).toBe(YELLOW);
    expect(fb.get(W - 2, y)).toBe(YELLOW);
    // Light: only a few dots across the middle, nothing yellow there.
    let yellow = 0;
    for (let x = 0; x < W; x++) if (fb.get(x, y) === YELLOW) yellow++;
    expect(yellow).toBe(8);
  });
});
