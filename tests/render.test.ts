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
        "air": "2a82558d",
        "crash-hit": "52cbb925",
        "crash-tumble": "44b5acd5",
        "flip": "8c36ef7c",
        "over": "6514ccff",
        "paused": "1cc09956",
        "ride-10s": "e03ec17a",
        "ride-12s": "ad5f56cc",
        "ride-14s": "d4303626",
        "ride-16s": "c4f8aaec",
        "ride-18s": "8da80d0f",
        "ride-20s": "27254c56",
        "ride-22s": "86fcc738",
        "ride-24s": "a76dbf87",
        "ride-26s": "f04680c9",
        "ride-28s": "0c0ee35f",
        "ride-2s": "cd16e8f9",
        "ride-30s": "aa698f83",
        "ride-32s": "adca2084",
        "ride-34s": "5e602205",
        "ride-36s": "c005729a",
        "ride-38s": "862b11f0",
        "ride-40s": "d680b6f2",
        "ride-4s": "10f5d3f0",
        "ride-6s": "afdf426c",
        "ride-8s": "ff94ab30",
        "spin": "7f34cd24",
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
        "air": "3acbeb0d",
        "crash-hit": "a2cda99d",
        "crash-tumble": "550ec35d",
        "flip": "4a7599c4",
        "over": "ddbc0e93",
        "paused": "b610aa40",
        "ride-10s": "1436294d",
        "ride-12s": "f8ac9c05",
        "ride-14s": "33f7ef33",
        "ride-16s": "2e47edcb",
        "ride-18s": "02527817",
        "ride-20s": "c4b67179",
        "ride-22s": "c0b19e0d",
        "ride-24s": "124c311f",
        "ride-26s": "8bfa9737",
        "ride-28s": "75789e5f",
        "ride-2s": "fb709da8",
        "ride-30s": "0d96468c",
        "ride-32s": "50ecbde1",
        "ride-34s": "931682c1",
        "ride-36s": "d959dd0f",
        "ride-38s": "c3764ad9",
        "ride-40s": "2ddc5976",
        "ride-4s": "670d301f",
        "ride-6s": "9177ca5c",
        "ride-8s": "0cf132d0",
        "spin": "85ccc84d",
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
        "air": "1dd6c444",
        "crash-hit": "1c99b759",
        "crash-tumble": "11e8a97a",
        "flip": "70646afe",
        "over": "532f7951",
        "paused": "df3f5725",
        "ride-10s": "28759ecf",
        "ride-12s": "40aa1e0f",
        "ride-14s": "3c6e6839",
        "ride-16s": "370530a1",
        "ride-18s": "0b90be19",
        "ride-20s": "65967238",
        "ride-22s": "fbed5ceb",
        "ride-24s": "e3222d62",
        "ride-26s": "992e1a1e",
        "ride-28s": "9c7665b0",
        "ride-2s": "fab1481d",
        "ride-30s": "8c3bb60d",
        "ride-32s": "9586ff5f",
        "ride-34s": "7a9a5d9e",
        "ride-36s": "7daca186",
        "ride-38s": "68792593",
        "ride-40s": "a4625ce7",
        "ride-4s": "9cedfce7",
        "ride-6s": "37195c2a",
        "ride-8s": "9c0b4309",
        "spin": "2f72914d",
        "start": "d1d16f9a",
        "title": "a5ff0c76",
        "title-gear": "30bb93e8",
        "title-goals": "fea8c3d3",
        "title-scores": "7e5089ef",
      }
    `);
  });
});
