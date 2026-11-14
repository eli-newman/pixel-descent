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

function capture(kit: 'snowboard' | 'skis' = 'snowboard'): {
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
        "crash-hit": "9d85a072",
        "crash-tumble": "a225b6c5",
        "flip": "f70fb5b0",
        "over": "4baadfd4",
        "paused": "bfab106c",
        "ride-10s": "cb725416",
        "ride-12s": "a668f3dd",
        "ride-14s": "ceb798fb",
        "ride-16s": "ddcff474",
        "ride-18s": "388eea36",
        "ride-20s": "308480cc",
        "ride-22s": "6f92c629",
        "ride-24s": "00c4f212",
        "ride-26s": "f04680c9",
        "ride-28s": "6fe86e6b",
        "ride-2s": "e4598300",
        "ride-30s": "daffe41e",
        "ride-32s": "b8677ac6",
        "ride-34s": "9f799f4e",
        "ride-36s": "e9d2e69a",
        "ride-38s": "a57f9904",
        "ride-40s": "17f3b30d",
        "ride-4s": "f7066f3c",
        "ride-6s": "d17c5bb7",
        "ride-8s": "e3b1fd1b",
        "spin": "14f49224",
        "start": "e26fd10c",
        "title": "0dfed2f8",
        "title-gear": "c62f51c0",
        "title-goals": "39cdbb03",
        "title-scores": "7474a8dc",
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
        "crash-hit": "9cf0c4e2",
        "crash-tumble": "12167fe5",
        "flip": "191141d1",
        "over": "b5862c20",
        "paused": "95997015",
        "ride-10s": "0cbbad05",
        "ride-12s": "c3552ac4",
        "ride-14s": "ea354ebe",
        "ride-16s": "723c64cb",
        "ride-18s": "bf2f3c6e",
        "ride-20s": "ac6afc7a",
        "ride-22s": "7f798e88",
        "ride-24s": "31f57a7a",
        "ride-26s": "8bfa9737",
        "ride-28s": "8d272cca",
        "ride-2s": "9b383739",
        "ride-30s": "1a9daf03",
        "ride-32s": "2bf365f6",
        "ride-34s": "bf272d67",
        "ride-36s": "2ea4436b",
        "ride-38s": "32477ea5",
        "ride-40s": "061597fe",
        "ride-4s": "531fe49b",
        "ride-6s": "edf5b036",
        "ride-8s": "4ac85ada",
        "spin": "3dd1517d",
        "start": "3dbbf2f5",
        "title": "0dfed2f8",
        "title-gear": "273460f0",
        "title-goals": "c25abb96",
        "title-scores": "7474a8dc",
      }
    `);
  });

  it('is repeatable', () => {
    expect(capture().frames).toEqual(capture().frames);
  });
});
