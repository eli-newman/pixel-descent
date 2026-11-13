import { describe, expect, it } from 'vitest';
import { PEBBLE_SIZE, isPebble, testObstacle } from '../src/sim/collision';
import type { Obstacle, ObstacleKind } from '../src/sim/types';
import { getSprite, type Sprite } from '../src/render/sprites';

function obstacle(kind: ObstacleKind, size: number): Obstacle {
  return { id: 1, kind, size, variant: 0, x: 100, y: 200, half: 9, judged: false, touched: false };
}

/** The highest filled row in every column of a sprite: its top silhouette, left to right. */
function skyline(sp: Sprite): number[] {
  const top = new Map<number, number>();
  for (let i = 0; i < sp.pts.length; i += 2) {
    const x = sp.pts[i] ?? 0;
    const y = sp.pts[i + 1] ?? 0;
    top.set(x, Math.min(top.get(x) ?? 0, y));
  }
  return [...top.entries()].sort((a, b) => a[0] - b[0]).map(([, y]) => y);
}

/** How many separate bumps a silhouette has: each time it starts to fall again after rising (smaller y is higher). */
function bumps(line: readonly number[]): number {
  let n = 0;
  let falling = false;
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1] ?? 0;
    const cur = line[i] ?? 0;
    if (cur > prev && !falling) {
      n++;
      falling = true;
    } else if (cur < prev) falling = false;
  }
  return n;
}

/** Single empty pixels with all eight neighbours filled: the leaf texture. Rock cracks and shading are diagonal lines, so they never count. */
function leafHoles(sp: Sprite): number {
  const pts = filled(sp);
  let holes = 0;
  for (let y = -40; y < 0; y++) {
    for (let x = -20; x <= 20; x++) {
      if (pts.has(`${x},${y}`)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (pts.has(`${x + dx},${y + dy}`)) n++;
      if (n === 8) holes++;
    }
  }
  return holes;
}

function filled(sp: Sprite): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < sp.pts.length; i += 2) s.add(`${sp.pts[i]},${sp.pts[i + 1]}`);
  return s;
}

describe('readable objects', () => {
  it('draws a pebble flat, with no shadow, so it never passes for a rock you crash into', () => {
    for (let size = 5; size < PEBBLE_SIZE; size++) {
      const sp = getSprite('rock', size, size);
      expect(isPebble('rock', size)).toBe(true);
      expect(testObstacle({ x: 100, y: 192 }, obstacle('rock', size))).toBe('none');
      expect(sp.shadow.length).toBe(0);
      expect(sp.top).toBeGreaterThanOrEqual(-1);
      expect(sp.pts.length / 2).toBeLessThanOrEqual(9);
    }
  });

  it('gives everything that stands up out of the snow a cast shadow', () => {
    const solid: Array<[ObstacleKind, number]> = [
      ['tree', 10],
      ['tree', 30],
      ['dead', 18],
      ['rock', PEBBLE_SIZE],
      ['rock', 24],
      ['bush', 1],
    ];
    for (const [kind, size] of solid)
      expect(getSprite(kind, size, 0).shadow.length).toBeGreaterThan(0);
  });

  it('gives a bush a bumpy top and far more leaf holes than any rock', () => {
    const bush = getSprite('bush', 1, 0);
    expect(bumps(skyline(bush))).toBeGreaterThanOrEqual(3);
    expect(leafHoles(bush)).toBeGreaterThanOrEqual(6);
    // Rock cracks and shading leave a stray hole here and there; the bush is speckled all over.
    const density = (sp: Sprite): number => leafHoles(sp) / (sp.pts.length / 2);
    let rockMax = 0;
    for (let v = 0; v < 8; v++) {
      for (const size of [PEBBLE_SIZE, 11, 13, 16, 20, 26]) {
        rockMax = Math.max(rockMax, density(getSprite('rock', size, v)));
      }
    }
    expect(density(bush)).toBeGreaterThan(rockMax * 3);
  });
});
