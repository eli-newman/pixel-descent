import { describe, expect, it } from 'vitest';
import { CHECKPOINTS_ENABLED, START_X, START_Y } from '../src/config';
import { circleHitsBox, obstacleBox, RIDER_RADIUS } from '../src/collision';
import { hashSeed } from '../src/rng';
import { maxFlightPx, topSpeed } from '../src/rider';
import { Sim } from '../src/sim';
import { LANE_HALF, SAFE_LANE_END_Y, Spawner, pathHalfWidth } from '../src/world/spawner';
import { runBot } from './helpers/bot';

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

  it.skipIf(!CHECKPOINTS_ENABLED)('places checkpoint gates inside the open path', () => {
    const s = new Spawner(hashSeed('gates'));
    const batch = s.advance(6000);
    expect(batch.gates.length).toBeGreaterThan(2);
    for (const g of batch.gates) expect(Math.abs(g.x - s.pathCenter(g.y))).toBeLessThan(1);
  });
});

describe('spawner invariants for jumps, lanes and terrain', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => `inv-${i}`);

  it('keeps landing zones free of solid obstacles, sized for top speed', () => {
    let ramps = 0;
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      const batch = s.advance(START_Y + 60000);
      for (const r of batch.ramps) {
        ramps++;
        const distM = (r.y - START_Y) / 8;
        expect(r.landEnd - r.y).toBeGreaterThanOrEqual(
          maxFlightPx(topSpeed(distM), r.kind === 'cliff') + 109,
        );
        if (r.kind === 'kicker') expect(Math.abs(r.x - s.pathCenter(r.y))).toBeLessThan(1);
        else expect(r.half).toBeGreaterThanOrEqual(90);
        for (const o of batch.obstacles) {
          if (!obstacleBox(o)) continue;
          expect(o.y < r.y - 14 || o.y > r.landEnd).toBe(true);
        }
      }
    }
    expect(ramps).toBeGreaterThan(30);
  });

  it('spawns both kickers and cliffs', () => {
    const s = new Spawner(hashSeed('mix'));
    const batch = s.advance(START_Y + 60000);
    expect(batch.ramps.some((r) => r.kind === 'cliff')).toBe(true);
    expect(batch.ramps.some((r) => r.kind === 'kicker')).toBe(true);
  });

  it('gives every cliff its own look, open slope beside the rock, and sometimes just a side cliff', () => {
    const s = new Spawner(hashSeed('gaps'));
    const cliffs = s.advance(START_Y + 150000).ramps.filter((r) => r.kind === 'cliff');
    expect(cliffs.length).toBeGreaterThan(5);
    for (const c of cliffs) {
      expect(c.segs.length).toBeGreaterThan(0);
      const rock = c.segs.reduce((n, g) => n + (g.x1 - g.x0), 0);
      expect(rock).toBeLessThan(180 - 15);
      for (const g of c.segs) expect(g.x1 - g.x0).toBeGreaterThanOrEqual(12);
    }
    expect(new Set(cliffs.map((c) => c.seed)).size).toBe(cliffs.length);
    const sideOnly = cliffs.filter((c) => c.segs.length === 1);
    expect(sideOnly.length).toBeGreaterThan(0);
    expect(sideOnly.some((c) => c.segs[0].x0 === 0)).toBe(true);
    expect(sideOnly.some((c) => c.segs[0].x1 === 180)).toBe(true);
  });

  it('keeps risk lanes open: corridor, entry and exit strips, stars', () => {
    let lanes = 0;
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      const batch = s.advance(START_Y + 60000);
      for (const lane of s.lanes) {
        if (lane.y1 > START_Y + 59000) continue;
        lanes++;
        const stars = batch.pickups.filter((p) => p.lane && p.y >= lane.y0 && p.y <= lane.y1);
        expect(stars.length).toBeGreaterThan(6);
        for (const p of stars) {
          expect(p.value).toBe(30);
          expect(p.x).toBeGreaterThan(10);
          expect(p.x).toBeLessThan(170);
        }
        for (const o of batch.obstacles) {
          const box = obstacleBox(o);
          if (!box || o.y < lane.y0 || o.y > lane.y1) continue;
          const lx = s.laneX(lane, o.y);
          const w = (box.x1 - box.x0) / 2;
          expect(Math.abs(o.x - lx)).toBeGreaterThanOrEqual(LANE_HALF + w + 2);
          // the strip between the main path and the lane stays open at both ends
          if (o.y < lane.y0 + 38 || o.y > lane.y1 - 38) {
            const c = s.pathCenter(o.y);
            const lo = Math.min(c, lx) - LANE_HALF;
            const hi = Math.max(c, lx) + LANE_HALF;
            expect(o.x + w < lo || o.x - w > hi).toBe(true);
          }
        }
        // a rider can stay inside the lane the whole way: it never leaves the slope
        for (let y = lane.y0; y <= lane.y1; y += 8) {
          expect(s.laneX(lane, y)).toBeGreaterThan(11);
          expect(s.laneX(lane, y)).toBeLessThan(169);
        }
      }
    }
    expect(lanes).toBeGreaterThan(20);
  });

  it('keeps patches off lanes and stars out of solid obstacles', () => {
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      const batch = s.advance(START_Y + 40000);
      expect(batch.patches.some((p) => p.kind === 'ice')).toBe(true);
      expect(batch.patches.some((p) => p.kind === 'drift')).toBe(true);
      for (const p of batch.patches) {
        expect(s.laneAt(p.y)).toBeNull();
      }
      for (const star of batch.pickups) {
        for (const o of batch.obstacles) {
          const box = obstacleBox(o);
          if (!box || o.y < star.y - 30 || o.y > star.y + 30) continue;
          if (!star.lane) continue;
          expect(circleHitsBox(star.x, star.y, 2, box)).toBe(false);
        }
      }
    }
  });

  it('stays winnable at maximum speed and high distance, with jumps, drifts and the avalanche', () => {
    for (const seed of seeds) {
      const sim = new Sim(seed, { forceSpeed: true });
      runBot(sim, 7000);
      expect(sim.crashed).toBe(false);
      expect(sim.distM).toBeGreaterThanOrEqual(7000);
      expect(sim.score.landings).toBeGreaterThan(3);
    }
  });

  it('stays winnable for a bot that is slowed by drifts and ice (no forced speed)', () => {
    for (const seed of seeds.slice(0, 6)) {
      const sim = new Sim(seed);
      runBot(sim, 4000);
      expect(sim.crashed).toBe(false);
    }
  });

  it('is deterministic for lanes, ramps and patches regardless of chunking', () => {
    const whole = new Spawner(hashSeed('feat'));
    whole.advance(20000);
    const parts = new Spawner(hashSeed('feat'));
    for (let y = 500; y <= 20000; y += 777) parts.advance(y);
    parts.advance(20000);
    const n = Math.min(whole.ramps.length, parts.ramps.length);
    expect(n).toBeGreaterThan(5);
    expect(parts.ramps.slice(0, n)).toEqual(whole.ramps.slice(0, n));
    expect(parts.lanes.slice(0, 5)).toEqual(whole.lanes.slice(0, 5));
    expect(parts.patches.slice(0, 10)).toEqual(whole.patches.slice(0, 10));
  });

  it('keeps the open path wide enough for speed: wider than the old formula at distance', () => {
    expect(pathHalfWidth(0)).toBeGreaterThanOrEqual(30);
    expect(pathHalfWidth(4000)).toBeGreaterThanOrEqual(23);
  });
});

describe('mountain world is stable', () => {
  it('generates the same world for a seed as it always has', () => {
    const fp = (seed: string): [number, number, number] => {
      const b = new Spawner(hashSeed(seed)).advance(20000);
      // Fingerprints taken when batches still carried an (empty) `props` list, so it is added back here.
      return [hashSeed(JSON.stringify({ ...b, props: [] })), b.obstacles.length, b.ramps.length];
    };
    expect(fp('alpha')).toEqual([4040464968, 1058, 8]);
    expect(fp('k3m9qa')).toEqual([3537220680, 1081, 8]);
  });
});
