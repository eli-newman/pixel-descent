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
        "air": "486e2325",
        "crash-hit": "05419185",
        "crash-tumble": "9fd757d4",
        "flip": "e0ed4474",
        "over": "a72c9aff",
        "paused": "ba936f16",
        "ride-10s": "96bef4bf",
        "ride-12s": "c2a8b14c",
        "ride-14s": "bb2ac313",
        "ride-16s": "1628e83d",
        "ride-18s": "845a7907",
        "ride-20s": "e892aa57",
        "ride-22s": "72e6bb70",
        "ride-24s": "d0b32946",
        "ride-26s": "bb1d3f78",
        "ride-28s": "e626b042",
        "ride-2s": "3639b3d8",
        "ride-30s": "ed31cecd",
        "ride-32s": "61d58da9",
        "ride-34s": "6be663f1",
        "ride-36s": "f09a8ef6",
        "ride-38s": "fb873dc8",
        "ride-40s": "8a2d5dee",
        "ride-4s": "47e1dab5",
        "ride-6s": "3eabd01c",
        "ride-8s": "32dcbcf1",
        "spin": "3484deb5",
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
        "air": "28de6cdc",
        "crash-hit": "768b425d",
        "crash-tumble": "8639503c",
        "flip": "ac6f5445",
        "over": "9641bdeb",
        "paused": "0abc78e8",
        "ride-10s": "5966f29c",
        "ride-12s": "9ec016dd",
        "ride-14s": "16b9e623",
        "ride-16s": "9387cc3f",
        "ride-18s": "27defe0f",
        "ride-20s": "1719df10",
        "ride-22s": "95615aa9",
        "ride-24s": "e1e0b18e",
        "ride-26s": "43947511",
        "ride-28s": "c4379342",
        "ride-2s": "f9333c88",
        "ride-30s": "2af742c3",
        "ride-32s": "a7ac033c",
        "ride-34s": "4260e2ac",
        "ride-36s": "ab871303",
        "ride-38s": "c33de888",
        "ride-40s": "06f0c35f",
        "ride-4s": "fd4240eb",
        "ride-6s": "0d7fd56d",
        "ride-8s": "e67c6351",
        "spin": "a4db2785",
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
        "air": "945a767d",
        "crash-hit": "cd5dd3d8",
        "crash-tumble": "a4934dba",
        "flip": "dc8420e2",
        "over": "efe6f9f0",
        "paused": "a23690b2",
        "ride-10s": "426ee828",
        "ride-12s": "cf795ed5",
        "ride-14s": "a5bd9bdd",
        "ride-16s": "e2c427f0",
        "ride-18s": "35c309b5",
        "ride-20s": "811166e5",
        "ride-22s": "bdc04035",
        "ride-24s": "9a845d5a",
        "ride-26s": "1a29fcd4",
        "ride-28s": "fe5bd16a",
        "ride-2s": "a9688a82",
        "ride-30s": "3c954be6",
        "ride-32s": "f17a8208",
        "ride-34s": "58d12197",
        "ride-36s": "2ab09830",
        "ride-38s": "3dffa290",
        "ride-40s": "dd48e670",
        "ride-4s": "e85f369f",
        "ride-6s": "1593bf7f",
        "ride-8s": "ecf24231",
        "spin": "bce32691",
        "start": "d1d16f9a",
        "title": "a5ff0c76",
        "title-gear": "30bb93e8",
        "title-goals": "fea8c3d3",
        "title-scores": "7e5089ef",
      }
    `);
  });
});
