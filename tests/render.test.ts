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
        "air": "9e98e1a7",
        "crash-hit": "cff3bfa7",
        "crash-tumble": "d881381d",
        "flip": "2c61f3fb",
        "over": "ec7de2be",
        "paused": "d3573bd6",
        "ride-10s": "3cbdc99d",
        "ride-12s": "ae267d16",
        "ride-14s": "66653779",
        "ride-16s": "a08123a7",
        "ride-18s": "9655ba46",
        "ride-20s": "d45ad7cd",
        "ride-22s": "e554d18b",
        "ride-24s": "f22b611e",
        "ride-26s": "c9026001",
        "ride-28s": "62085c76",
        "ride-2s": "e7295cf0",
        "ride-30s": "19bd9850",
        "ride-32s": "e3448cdd",
        "ride-34s": "03bd6779",
        "ride-36s": "29df7002",
        "ride-38s": "153acc8a",
        "ride-40s": "76f4aa43",
        "ride-4s": "8dabb2cb",
        "ride-6s": "85032834",
        "ride-8s": "9dc3af93",
        "spin": "7e8fec7f",
        "start": "1827df37",
        "title": "ff24492c",
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
        "air": "1682e937",
        "crash-hit": "8196fdd3",
        "crash-tumble": "5ebe67c5",
        "flip": "8a5b5a23",
        "over": "2590845e",
        "paused": "c6d6c83f",
        "ride-10s": "ee969264",
        "ride-12s": "e2390286",
        "ride-14s": "220b6a58",
        "ride-16s": "ed2a08b8",
        "ride-18s": "f7e0247a",
        "ride-20s": "53a76e95",
        "ride-22s": "fd2c2466",
        "ride-24s": "ed91d8ca",
        "ride-26s": "3d8ddf5e",
        "ride-28s": "aa25949e",
        "ride-2s": "407514a0",
        "ride-30s": "a7abf7b9",
        "ride-32s": "fc0e941d",
        "ride-34s": "62ee1bd9",
        "ride-36s": "e1ae8c27",
        "ride-38s": "9b5e189a",
        "ride-40s": "f8f9fdc4",
        "ride-4s": "0faf5e91",
        "ride-6s": "6a31ef9c",
        "ride-8s": "c4d50ff8",
        "spin": "e75c5927",
        "start": "e412232e",
        "title": "ff24492c",
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
        "air": "d557559f",
        "crash-hit": "d1dbf4b0",
        "crash-tumble": "a5763506",
        "flip": "4018cf6e",
        "over": "47eef0a6",
        "paused": "194203d3",
        "ride-10s": "6e9b5fbb",
        "ride-12s": "a324ee40",
        "ride-14s": "253bf75f",
        "ride-16s": "c4860214",
        "ride-18s": "2e9927ff",
        "ride-20s": "356f2aaf",
        "ride-22s": "916f609e",
        "ride-24s": "7138816a",
        "ride-26s": "2ad38b87",
        "ride-28s": "f650c480",
        "ride-2s": "d98ea048",
        "ride-30s": "9a45237c",
        "ride-32s": "5edb6d4d",
        "ride-34s": "4a3cc520",
        "ride-36s": "ac3981e3",
        "ride-38s": "f9ca3363",
        "ride-40s": "a27c02f2",
        "ride-4s": "4575a36b",
        "ride-6s": "87ac4238",
        "ride-8s": "43ef8ed6",
        "spin": "0866e1a0",
        "start": "d1d16f9a",
        "title": "95f24633",
        "title-gear": "30bb93e8",
        "title-goals": "fea8c3d3",
        "title-scores": "7e5089ef",
      }
    `);
  });
});
