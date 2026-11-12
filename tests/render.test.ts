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
        "air": "fc11686d",
        "crash-hit": "be8486c1",
        "crash-tumble": "0d2bd0dd",
        "flip": "f70fb5b0",
        "over": "fef1a30c",
        "paused": "967001b8",
        "ride-10s": "20bf2b9b",
        "ride-12s": "a668f3dd",
        "ride-14s": "ce08be2b",
        "ride-16s": "19bb8188",
        "ride-18s": "388eea36",
        "ride-20s": "3fbfd7d3",
        "ride-22s": "e375c461",
        "ride-24s": "00c4f212",
        "ride-26s": "f04680c9",
        "ride-28s": "6fe86e6b",
        "ride-2s": "bdedf8f0",
        "ride-30s": "d94f6fe2",
        "ride-32s": "7f9346f4",
        "ride-34s": "dab6127d",
        "ride-36s": "49b5b55f",
        "ride-38s": "00e26404",
        "ride-40s": "088dbe5e",
        "ride-4s": "cf525100",
        "ride-6s": "6a7d2d8f",
        "ride-8s": "8a4ac39c",
        "spin": "14f49224",
        "start": "cf57f5cf",
        "title": "ffe82a4d",
        "title-gear": "e25ac54c",
        "title-goals": "39cdbb03",
        "title-scores": "8b9cf883",
      }
    `);
  });

  it('draws the same run on skis', () => {
    const { frames, spun, flipped } = capture('skis');
    expect(spun).toBe(true);
    expect(flipped).toBe(true);
    const board = capture().frames;
    // The title and SCORES come before GEAR picks the skis, so they are the same; every frame after it shows the
    // skier (GOALS too: menus have no card, so the slope and its rider show through).
    const same = Object.keys(frames).filter((k) => frames[k] === board[k]);
    expect(same.sort()).toEqual(['title', 'title-scores']);
    expect(frames).toMatchInlineSnapshot(`
      {
        "air": "4b76f74d",
        "crash-hit": "0cb22271",
        "crash-tumble": "676b9f9c",
        "flip": "191141d1",
        "over": "e14c6e15",
        "paused": "7f6e484a",
        "ride-10s": "1511d5f8",
        "ride-12s": "c3552ac4",
        "ride-14s": "8a5266ae",
        "ride-16s": "67783dfb",
        "ride-18s": "bf2f3c6e",
        "ride-20s": "0ea59869",
        "ride-22s": "aabaf19c",
        "ride-24s": "31f57a7a",
        "ride-26s": "8bfa9737",
        "ride-28s": "8d272cca",
        "ride-2s": "87cd70c1",
        "ride-30s": "5d45587b",
        "ride-32s": "1695f424",
        "ride-34s": "3f182c94",
        "ride-36s": "d47a6397",
        "ride-38s": "64c3d505",
        "ride-40s": "3c90c341",
        "ride-4s": "f70c412f",
        "ride-6s": "9bcb0ece",
        "ride-8s": "68a22b3d",
        "spin": "3dd1517d",
        "start": "190a8eb6",
        "title": "ffe82a4d",
        "title-gear": "12773c6f",
        "title-goals": "c25abb96",
        "title-scores": "8b9cf883",
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
        "air": "e8e4af6a",
        "crash-hit": "5b60e49d",
        "crash-tumble": "adc50583",
        "flip": "cfcf7bd4",
        "over": "3912654a",
        "paused": "0ddac124",
        "ride-10s": "7db250e1",
        "ride-12s": "b38800da",
        "ride-14s": "cbce9939",
        "ride-16s": "e56a467c",
        "ride-18s": "f32476d7",
        "ride-20s": "05ee646d",
        "ride-22s": "8ad6bfdb",
        "ride-24s": "741c06cc",
        "ride-26s": "e1fd205e",
        "ride-28s": "b271b6b3",
        "ride-2s": "86504eb8",
        "ride-30s": "a98f20ba",
        "ride-32s": "2dbd1695",
        "ride-34s": "a45b9723",
        "ride-36s": "0335dd01",
        "ride-38s": "79cc0278",
        "ride-40s": "7826d430",
        "ride-4s": "1732f7d9",
        "ride-6s": "992f9a84",
        "ride-8s": "085a937d",
        "spin": "5d5bc246",
        "start": "6c913730",
        "title": "00859dc7",
        "title-gear": "b3bfae2b",
        "title-goals": "dd94bf95",
        "title-scores": "7a84e2f4",
      }
    `);
  });
});
