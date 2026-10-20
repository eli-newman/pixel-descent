import { describe, expect, it } from 'vitest';
import { START_X, START_Y } from '../src/config';
import { circleHitsBox, obstacleBox, RIDER_RADIUS } from '../src/collision';
import { hashSeed } from '../src/rng';
import { SAFE_LANE_END_Y, Spawner, pathHalfWidth } from '../src/world/spawner';

describe('spawner', () => {
  it('is deterministic for a seed', () => {
    const a = new Spawner(hashSeed('alpha')).advance(3000);
    const b = new Spawner(hashSeed('alpha')).advance(3000);
    expect(a).toEqual(b);
    const c = new Spawner(hashSeed('beta')).advance(3000);
    expect(c).not.toEqual(a);
  });

  it('does not depend on how the advance calls are chunked', () => {
    const whole = new Spawner(hashSeed('chunks')).advance(4000);
    const s = new Spawner(hashSeed('chunks'));
    const parts = [s.advance(500), s.advance(501), s.advance(2300), s.advance(4000)];
    expect(parts.flatMap((p) => p.obstacles)).toEqual(whole.obstacles);
    const byId = <T extends { id: number }>(l: T[]): T[] => l.slice().sort((a, b) => a.id - b.id);
    expect(byId(parts.flatMap((p) => p.pickups))).toEqual(byId(whole.pickups));
    expect(parts.flatMap((p) => p.gates)).toEqual(whole.gates);
  });

  it('keeps the rider lane clear at the start for every seed', () => {
    for (let i = 0; i < 60; i++) {
      const batch = new Spawner(hashSeed(`seed-${i}`)).advance(SAFE_LANE_END_Y + 100);
      expect(batch.obstacles.length).toBeGreaterThan(0);
      for (const o of batch.obstacles) {
        if (o.y > SAFE_LANE_END_Y) continue;
        const box = obstacleBox(o);
        if (!box) continue;
        // A rider holding the starting lane (a body-width wide strip) never touches it.
        for (const x of [START_X - 14, START_X, START_X + 14]) {
          for (let y = START_Y; y < SAFE_LANE_END_Y; y += 2) {
            expect(circleHitsBox(x, y + 8, RIDER_RADIUS, box)).toBe(false);
          }
        }
      }
    }
  });

  it('spawns nothing in the first rows below the start', () => {
    const batch = new Spawner(hashSeed('early')).advance(SAFE_LANE_END_Y);
    for (const o of batch.obstacles) expect(o.y).toBeGreaterThan(START_Y + 60);
  });

  it('always leaves an open path as wide as promised', () => {
    const s = new Spawner(hashSeed('path'));
    const batch = s.advance(12000);
    for (const o of batch.obstacles) {
      const box = obstacleBox(o);
      if (!box || o.kind === 'bush') continue;
      const gap = pathHalfWidth((o.y - START_Y) / 8);
      const c = s.pathCenter(o.y);
      const nearest = Math.max(box.x0 - c, c - box.x1, 0);
      expect(nearest).toBeGreaterThanOrEqual(gap);
    }
  });

  it('places checkpoint gates inside the open path', () => {
    const s = new Spawner(hashSeed('gates'));
    const batch = s.advance(6000);
    expect(batch.gates.length).toBeGreaterThan(2);
    for (const g of batch.gates) expect(Math.abs(g.x - s.pathCenter(g.y))).toBeLessThan(1);
  });
});
