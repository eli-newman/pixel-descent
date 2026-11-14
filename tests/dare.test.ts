import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { codeFromPath, darePath, decodeDare, encodeDare, type Dare } from '../src/core/dare';
import { Framebuffer, YELLOW } from '../src/render/framebuffer';
import { renderUi } from '../src/render/ui';
import type { Game } from '../src/state/game';
import { makeGame, stepUntil } from './helpers/fakes';

const DARE: Dare = {
  seed: 'k3m9qa',
  score: 1240,
  dist: 312,
  stars: 4,
  tricks: 3,
  end: 'tree',
  skis: false,
  board: 0,
  rider: 0,
};

describe('dare codes', () => {
  it('pack a run into a short readable code and read it back', () => {
    expect(encodeDare(DARE)).toBe('k3m9qa-1240-312-4-3-t');
    expect(darePath(DARE)).toBe('/c/k3m9qa-1240-312-4-3-t');
    for (const end of ['tree', 'dead', 'rock', 'bush', 'bail'] as const) {
      for (const skis of [false, true]) {
        const d = { ...DARE, end, skis, seed: 'd20261113' };
        expect(decodeDare(encodeDare(d))).toEqual(d);
      }
    }
  });

  it('carry the look only when it is not the plain one', () => {
    const d = { ...DARE, board: 2, rider: 3 };
    expect(encodeDare(d)).toBe('k3m9qa-1240-312-4-3-t-23');
    expect(decodeDare(encodeDare(d))).toEqual(d);
    const s = { ...DARE, skis: true, board: 0, rider: 1 };
    expect(encodeDare(s)).toBe('k3m9qa-1240-312-4-3-ts-01');
    expect(decodeDare(encodeDare(s))).toEqual(s);
    // Out of range looks are clamped to one digit, never a broken code.
    expect(encodeDare({ ...DARE, board: 42, rider: -1 })).toBe('k3m9qa-1240-312-4-3-t-90');
  });

  it('still read codes sent before looks were, in the plain look', () => {
    for (const [code, skis] of [
      ['k3m9qa-1240-312-4-3-t', false],
      ['d20261113-88-40-0-0-ls', true],
    ] as const) {
      const d = decodeDare(code);
      expect(d).not.toBeNull();
      expect(d?.skis).toBe(skis);
      expect(d?.board).toBe(0);
      expect(d?.rider).toBe(0);
      expect(d && encodeDare(d)).toBe(code);
    }
  });

  it('turn away anything that is not a dare', () => {
    for (const bad of [
      null,
      '',
      'k3m9qa',
      'k3m9qa-1240-312-4-3',
      'k3m9qa-1240-312-4-3-x',
      'K3M9QA-1240-312-4-3-t',
      'k3m9qa--1240-312-4-3-t',
      'k3m9qa-12.5-312-4-3-t',
      'k3m9qa-1240-312-4-3-t-extra',
      'k3m9qa-1240-312-4-3-t-1',
      'k3m9qa-1240-312-4-3-t-123',
      'k3m9qa-1240-312-4-3-t-',
      'abcdefghijklm-1-1-1-1-t',
      'k3m9qa-12345678-1-1-1-t',
      '<script>-1-1-1-1-t',
    ]) {
      expect(decodeDare(bad)).toBeNull();
    }
  });

  it('keep numbers whole and in range', () => {
    const code = encodeDare({ ...DARE, score: 1e12, dist: -5, stars: 2.7, tricks: Number.NaN });
    expect(code).toBe('k3m9qa-9999999-0-2-0-t');
    expect(decodeDare(code)?.score).toBe(9999999);
  });

  it('find the code in a link path, under any folder, with or without a trailing slash', () => {
    expect(codeFromPath('/c/k3m9qa-1240-312-4-3-t')).toBe('k3m9qa-1240-312-4-3-t');
    expect(codeFromPath('/c/k3m9qa-1240-312-4-3-t/')).toBe('k3m9qa-1240-312-4-3-t');
    expect(codeFromPath('/games/powline/c/abc')).toBe('abc');
    expect(codeFromPath('/')).toBeNull();
    expect(codeFromPath('/c/')).toBeNull();
    expect(codeFromPath('/c/abc/card.png')).toBeNull();
  });
});

/** Every pixel of the HUD layer, to look for yellow. */
function ui(game: Game): Framebuffer {
  const fb = new Framebuffer(W, H);
  fb.clear(0);
  renderUi(fb, game);
  return fb;
}

function yellowCount(fb: Framebuffer): number {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fb.get(x, y) === YELLOW) n++;
  return n;
}

describe('playing a dare', () => {
  it("opens on the friend's course with their score to beat", () => {
    const { game } = makeGame('ignored', {}, undefined, { dare: DARE });
    expect(game.seed).toBe(DARE.seed);
    expect(game.dare).toEqual(DARE);
    // The title's best line becomes the score to beat, in yellow.
    const plain = makeGame(DARE.seed).game;
    game.update(1 / 120);
    plain.update(1 / 120);
    expect(yellowCount(ui(game))).toBeGreaterThan(yellowCount(ui(plain)));
  });

  it('plays exactly the course a plain link to it plays', () => {
    const a = makeGame('x', {}, undefined, { dare: DARE });
    const b = makeGame(DARE.seed);
    for (const r of [a, b]) {
      r.input.push('start');
      stepUntil(r.game, () => r.game.phase === 'over');
    }
    expect(a.game.result?.score).toBe(b.game.result?.score);
    expect(a.game.result?.dist).toBe(b.game.result?.dist);
  });

  it('holds through RETRY and ends on any other course', () => {
    const { game, input } = makeGame('x', {}, undefined, { dare: DARE });
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    stepUntil(game, () => game.overReady);
    game.press('retry');
    expect(game.dare).toEqual(DARE);
    expect(game.seed).toBe(DARE.seed);
    stepUntil(game, () => game.phase === 'over');
    stepUntil(game, () => game.overReady);
    game.press('again');
    expect(game.dare).toBeNull();
    expect(game.seed).not.toBe(DARE.seed);
  });

  it('sends a finished run back as a new dare on the same course, with how it ended', async () => {
    const { game, input, shared } = makeGame('x', {}, undefined, { dare: DARE });
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    stepUntil(game, () => game.overReady);
    await game.share();
    const sent = shared[0] as Dare;
    expect(sent.seed).toBe(DARE.seed);
    expect(sent.score).toBe(game.result?.score);
    expect(sent.dist).toBe(game.result?.dist);
    expect(sent.end).toBe(game.sim.crashCause === 'bail' ? 'bail' : game.sim.killer?.kind);
    expect(sent.skis).toBe(false);
    expect(sent.board).toBe(0);
    expect(sent.rider).toBe(0);
  });

  it("sends the player's unlocked look along with the dare", async () => {
    const { game, input, shared, store } = makeGame('x');
    const p = store.progress();
    p.stats.tricks = 10;
    p.stats.nearMisses = 50;
    p.gear = { board: 'dots', rider: 'ears', kit: 'skis' };
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    stepUntil(game, () => game.overReady);
    await game.share();
    const sent = shared[0] as Dare;
    expect([sent.board, sent.rider, sent.skis]).toEqual([2, 3, true]);
    expect(decodeDare(encodeDare(sent))).toEqual(sent);
  });

  it('labels its runs as a dare in analytics', () => {
    const { game, analytics } = makeGame('x', {}, undefined, { dare: DARE });
    game.press('play');
    expect(analytics.events.at(-1)?.data).toEqual({ run: '1', setup: 'board dare' });
  });
});
