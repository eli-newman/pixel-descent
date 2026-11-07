import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { Framebuffer } from '../src/render/framebuffer';
import { SceneRenderer } from '../src/render/scene';
import { renderUi } from '../src/render/ui';
import type { Game } from '../src/state/game';
import { botInput } from './helpers/bot';
import { makeGame, type FakeInput } from './helpers/fakes';

/**
 * Golden frames: the real scene and UI renderers, hashed pixel for pixel at fixed points of one
 * scripted run.
 * It is the safety net for refactors: a code cleanup must leave every hash alone.
 *
 * A changed hash means a visible pixel changed. If that is intended, look at the game first, then
 * refresh with `npx vitest run tests/render.test.ts -u` and review the diff.
 */
const SEED = 'g0';
const DT = 1 / 120;

/** FNV-1a over the RGBA bytes. */
function hash(fb: Framebuffer): string {
  let h = 0x811c9dc5;
  for (const byte of fb.data) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function draw(game: Game, scene: SceneRenderer): Framebuffer {
  const out = scene.render(game);
  renderUi(out, game);
  return out;
}

/** Point the rider down the open path, and tap flips while in the air. */
function ride(game: Game, input: FakeInput): void {
  const r = game.sim.rider;
  input.steerValue = botInput(game.sim).steer;
  input.flipValue = r.air && Math.floor(r.airT * 10) % 2 === 0 ? 1 : 0;
  game.update(DT);
}

function capture(
  kit: 'snowboard' | 'skis' = 'snowboard',
  color = false,
): {
  frames: Record<string, string>;
  spun: boolean;
  flipped: boolean;
} {
  const { game, input } = makeGame(SEED);
  const scene = new SceneRenderer(new Framebuffer(W, H));
  const frames: Record<string, string> = {};
  const shot = (name: string): void => {
    frames[name] = hash(draw(game, scene));
  };

  if (color) game.press('color');
  game.update(DT);
  shot('title');
  for (const screen of ['scores', 'gear', 'goals'] as const) {
    game.press(screen);
    if (screen === 'gear' && kit === 'skis') game.press('skis');
    game.update(DT);
    shot(`title-${screen}`);
    game.press('back');
    game.update(DT);
  }

  game.press('play');
  game.update(DT);
  shot('start');

  let flew = false;
  let spun = false;
  let flipped = false;
  for (let i = 1; i <= 120 * 40 && !game.sim.crashed; i++) {
    const r = game.sim.rider;
    if (r.air && !flew) {
      flew = true;
      input.push('trick');
      if (!frames['air']) shot('air');
    }
    if (!r.air) flew = false;
    ride(game, input);
    if (i % 240 === 0) shot(`ride-${i / 120}s`);
    if (r.air && r.spinDir !== 0 && !spun) {
      spun = true;
      shot('spin');
    }
    if (r.air && Math.abs(r.pitch) > 90 && !flipped) {
      flipped = true;
      shot('flip');
    }
  }

  input.releaseAll();
  input.flipValue = 0;
  input.push('pause');
  game.update(DT);
  shot('paused');
  input.push('start');
  game.update(DT);

  // Ride straight until something stops the run.
  for (let i = 0; i < 120 * 300 && !game.sim.crashed; i++) game.update(DT);
  shot('crash-hit');
  for (let i = 0; i < 30; i++) game.update(DT);
  shot('crash-tumble');
  for (let i = 0; i < 120 * 10 && game.phase !== 'over'; i++) game.update(DT);
  shot('over');
  return { frames, spun, flipped };
}

describe('golden frames', () => {
  it('draws the scripted run pixel for pixel', () => {
    const { frames, spun, flipped } = capture();
    expect(spun).toBe(true);
    expect(flipped).toBe(true);
    // Every frame differs, so no step of the script silently stopped drawing anything new.
    expect(
      Object.entries(frames).filter(([, h], i, all) => all.findIndex(([, o]) => o === h) !== i),
    ).toEqual([]);
    expect(frames).toMatchInlineSnapshot(`
      {
        "air": "b511b57d",
        "crash-hit": "0ffc3114",
        "crash-tumble": "c9f66604",
        "flip": "8c36ef7c",
        "over": "063242bf",
        "paused": "1cc09956",
        "ride-10s": "5f9c6d0f",
        "ride-12s": "8133e9d5",
        "ride-14s": "7f211a6e",
        "ride-16s": "c4f8aaec",
        "ride-18s": "845a7907",
        "ride-20s": "27254c56",
        "ride-22s": "0e3c04bc",
        "ride-24s": "63d4528f",
        "ride-26s": "b181dc40",
        "ride-28s": "6b2f6c73",
        "ride-2s": "cd16e8f9",
        "ride-30s": "81095b2c",
        "ride-32s": "adca2084",
        "ride-34s": "1b2d2271",
        "ride-36s": "14a27fa6",
        "ride-38s": "29408e49",
        "ride-40s": "d680b6f2",
        "ride-4s": "49c9b255",
        "ride-6s": "afdf426c",
        "ride-8s": "32dcbcf1",
        "spin": "369f3185",
        "start": "1827df37",
        "title": "cdb9c71d",
        "title-gear": "31f4dbb4",
        "title-goals": "e9135c03",
        "title-scores": "4c029d3b",
      }
    `);
  });

  it('draws the same run on skis', () => {
    const { frames, spun, flipped } = capture('skis');
    expect(spun).toBe(true);
    expect(flipped).toBe(true);
    const board = capture().frames;
    // The title and menus behind the GEAR screen are the same; every frame with the rider in it is not.
    const same = Object.keys(frames).filter((k) => frames[k] === board[k]);
    expect(same.sort()).toEqual(['title', 'title-goals', 'title-scores']);
    expect(frames).toMatchInlineSnapshot(`
      {
        "air": "3727768d",
        "crash-hit": "12e694a4",
        "crash-tumble": "0e70865d",
        "flip": "4a7599c4",
        "over": "5d3619da",
        "paused": "b610aa40",
        "ride-10s": "8b2bfed4",
        "ride-12s": "1be72584",
        "ride-14s": "e207b3fb",
        "ride-16s": "2e47edcb",
        "ride-18s": "27defe0f",
        "ride-20s": "c4b67179",
        "ride-22s": "3b2fcb81",
        "ride-24s": "3ed8cf9e",
        "ride-26s": "3a715f48",
        "ride-28s": "1552ef73",
        "ride-2s": "fb709da8",
        "ride-30s": "f4a6919b",
        "ride-32s": "50ecbde1",
        "ride-34s": "db3ab0b5",
        "ride-36s": "a139b0eb",
        "ride-38s": "cf71f051",
        "ride-40s": "2ddc5976",
        "ride-4s": "273e5436",
        "ride-6s": "9177ca5c",
        "ride-8s": "e67c6351",
        "spin": "e05b7ef4",
        "start": "e412232e",
        "title": "cdb9c71d",
        "title-gear": "da556ec2",
        "title-goals": "e9135c03",
        "title-scores": "4c029d3b",
      }
    `);
  });

  it('is repeatable', () => {
    expect(capture().frames).toEqual(capture().frames);
  });

  it('draws the same run in colour, with every frame different from black and white', () => {
    const { frames, spun, flipped } = capture('snowboard', true);
    expect(spun).toBe(true);
    expect(flipped).toBe(true);
    const mono = capture().frames;
    expect(Object.keys(frames).filter((k) => frames[k] === mono[k])).toEqual([]);
    expect(frames).toMatchInlineSnapshot(`
      {
        "air": "39fdeb8d",
        "crash-hit": "7527df54",
        "crash-tumble": "ba84b45c",
        "flip": "70646afe",
        "over": "96b8ce78",
        "paused": "df3f5725",
        "ride-10s": "220ebfec",
        "ride-12s": "c43126d6",
        "ride-14s": "2ce98e8d",
        "ride-16s": "370530a1",
        "ride-18s": "35c309b5",
        "ride-20s": "65967238",
        "ride-22s": "3f6a3192",
        "ride-24s": "5674664a",
        "ride-26s": "bbb118b4",
        "ride-28s": "e93aa9d2",
        "ride-2s": "fab1481d",
        "ride-30s": "2d0c71ea",
        "ride-32s": "9586ff5f",
        "ride-34s": "a4496dc4",
        "ride-36s": "f6b0d60d",
        "ride-38s": "173d72a5",
        "ride-40s": "a4625ce7",
        "ride-4s": "39f33438",
        "ride-6s": "37195c2a",
        "ride-8s": "ecf24231",
        "spin": "dbd0ce72",
        "start": "d1d16f9a",
        "title": "a5ff0c76",
        "title-gear": "30bb93e8",
        "title-goals": "fea8c3d3",
        "title-scores": "7e5089ef",
      }
    `);
  });
});
