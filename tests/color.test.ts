import { describe, expect, it } from 'vitest';
import { C } from '../src/render/palette';
import { getColorSprite, getSprite } from '../src/render/sprites';
import { isPebble } from '../src/sim/collision';
import type { ObstacleKind } from '../src/sim/types';
import { Store } from '../src/state/storage';
import { botInput } from './helpers/bot';
import { makeGame, memoryStorage } from './helpers/fakes';

/** Every sprite the spawner can make: its sizes, and every rock variant. */
const SPRITES: ReadonlyArray<readonly [ObstacleKind, number, number]> = [
  ...range(9, 38).map((s) => ['tree', s, 0] as const),
  ['bush', 1, 0],
  ...range(14, 22).map((s) => ['dead', s, 0] as const),
  ...range(5, 26).flatMap((s) => range(0, 7).map((v) => ['rock', s, v] as const)),
];

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function points(pts: Int16Array): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < pts.length; i += 2) out.add(`${pts[i]},${pts[i + 1]}`);
  return out;
}

describe('the colour setting', () => {
  it('is off for a new player and for saves from before it existed', () => {
    expect(new Store(memoryStorage()).settings().color).toBe(false);
    const storage = memoryStorage();
    new Store(storage).saveSettings({ muted: true });
    expect(new Store(storage).settings().color).toBe(false);
  });

  it('is switched by the COLOR button on the title screen and in the pause menu, and remembered', () => {
    const { game, storage } = makeGame();
    game.update(1 / 120);
    game.press('color');
    expect(new Store(storage).settings().color).toBe(true);
    game.press('play');
    game.update(1 / 120);
    game.togglePause();
    game.press('color');
    expect(new Store(storage).settings().color).toBe(false);
  });

  it('is only a look: the same inputs play the same run in colour', () => {
    const run = (color: boolean): string => {
      const { game, input } = makeGame('colour-run');
      if (color) game.press('color');
      game.update(1 / 120);
      game.press('play');
      for (let i = 0; i < 120 * 40 && game.phase === 'playing'; i++) {
        input.steerValue = botInput(game.sim).steer;
        game.update(1 / 120);
      }
      return `${game.phase} ${game.sim.scoreValue} ${game.sim.rider.x.toFixed(6)} ${game.sim.rider.y.toFixed(6)}`;
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('colour sprites', () => {
  it('cover every pixel of the black and white sprite, so the shape and its shadow stay the same', () => {
    const offenders: string[] = [];
    for (const [kind, size, variant] of SPRITES) {
      const color = points(getColorSprite(kind, size, variant).pts);
      const missing = [...points(getSprite(kind, size, variant).pts)].filter((p) => !color.has(p));
      if (missing.length > 0) offenders.push(`${kind} ${size}/${variant} misses ${missing.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('paint pines dark green with snow and a brown trunk, rocks grey or brown with a snow cap', () => {
    const offenders: string[] = [];
    const has = (kind: ObstacleKind, size: number, variant: number, c: number): boolean =>
      getColorSprite(kind, size, variant).colors.includes(c);
    for (const [kind, size, variant] of SPRITES) {
      const tag = `${kind} ${size}/${variant}`;
      if (kind === 'tree') {
        for (const [c, name] of [
          [C.pine, 'green'],
          [C.white, 'snow'],
          [C.bark, 'brown'],
        ] as const) {
          if (!has(kind, size, variant, c)) offenders.push(`${tag} has no ${name}`);
        }
      }
      if (kind === 'rock' && !isPebble(kind, size)) {
        const stone = variant % 2 === 1 ? C.rockBrown : C.rockGrey;
        if (!has(kind, size, variant, stone)) offenders.push(`${tag} is not grey or brown`);
        if (!has(kind, size, variant, C.white)) offenders.push(`${tag} has no snow`);
      }
      if (kind === 'dead' && !has(kind, size, variant, C.bark))
        offenders.push(`${tag} is not brown`);
    }
    expect(offenders).toEqual([]);
  });

  it('never leave snow touching the open slope: every white pixel is edged where it meets the snow', () => {
    const offenders: string[] = [];
    for (const [kind, size, variant] of SPRITES) {
      const sp = getColorSprite(kind, size, variant);
      const pts = points(sp.pts);
      for (let k = 0; k < sp.colors.length; k++) {
        if (sp.colors[k] !== C.white) continue;
        const x = sp.pts[k * 2] ?? 0;
        const y = sp.pts[k * 2 + 1] ?? 0;
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
          [1, 0],
        ]) {
          if (!pts.has(`${x + dx},${y + dy}`))
            offenders.push(`${kind} ${size}/${variant} at ${x},${y}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
