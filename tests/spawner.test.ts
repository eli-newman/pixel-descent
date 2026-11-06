import { describe, expect, it } from 'vitest';
import {
  FIRST_JUMP_Y,
  JUMP_GAP_MIN,
  LINE_RUNUP_MIN,
  PX_PER_M,
  START_X,
  START_Y,
} from '../src/core/config';
import { circleHitsBox, obstacleBox, RIDER_RADIUS } from '../src/sim/collision';
import { hashSeed } from '../src/core/rng';
import { maxFlightPx, topSpeed } from '../src/sim/speed';
import { Sim } from '../src/sim/sim';
import { LANE_HALF, SAFE_LANE_END_Y, Spawner, pathHalfWidth } from '../src/sim/spawner';
import { botInput, runBot } from './helpers/bot';

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
  });

  it('keeps the rider lane clear at the start for every seed', () => {
    for (let i = 0; i < 60; i++) {
      const batch = new Spawner(hashSeed(`seed-${i}`)).advance(SAFE_LANE_END_Y + 100);
      expect(batch.obstacles.length).toBeGreaterThan(0);
      // Plain checks, one expect at the end: expect is far too slow for a loop this deep.
      const hits: string[] = [];
      for (const o of batch.obstacles) {
        if (o.y > SAFE_LANE_END_Y) continue;
        const box = obstacleBox(o);
        if (!box) continue;
        // A rider holding the starting lane (a body-width wide strip) never touches it.
        for (const x of [START_X - 14, START_X, START_X + 14]) {
          for (let y = START_Y; y < SAFE_LANE_END_Y; y += 2) {
            if (circleHitsBox(x, y + 8, RIDER_RADIUS, box)) hits.push(`${o.kind}@${o.x},${o.y}`);
          }
        }
      }
      expect(hits).toEqual([]);
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
        // A jump, or the first kicker of a line, sits on the open path; the rest of a line lines up with it.
        if (r.kind === 'kicker') {
          if (r.lineIdx === 0) expect(Math.abs(r.x - s.pathCenter(r.y))).toBeLessThan(1);
        } else expect(r.half).toBeGreaterThanOrEqual(90);
        // Plain filter, one expect: expect is far too slow per ramp per obstacle.
        const inZone = batch.obstacles.filter(
          (o) => obstacleBox(o) && !(o.y < r.y - 14 || o.y > r.landEnd),
        );
        expect(inZone).toEqual([]);
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

  it('places a jump every 70 to 105 m on average, mostly kickers, the first one early', () => {
    const offenders: string[] = [];
    let kickers = 0;
    let all = 0;
    for (let i = 0; i < 60; i++) {
      const s = new Spawner(hashSeed(`freq-${i}`));
      const ramps = s.advance(START_Y + 5000 * PX_PER_M).ramps;
      const mPerJump = 5000 / ramps.length;
      if (mPerJump < 70 || mPerJump > 105) offenders.push(`freq-${i}: a jump every ${mPerJump} m`);
      // A line counts once: the next jump after it is planned from its end.
      const features = ramps.filter((r) => r.lineIdx === 0).length;
      const mPerFeature = 5000 / features;
      if (mPerFeature < 85 || mPerFeature > 135)
        offenders.push(`freq-${i}: a jump or line every ${mPerFeature} m`);
      const first = ramps[0];
      if (!first || first.y > START_Y + FIRST_JUMP_Y + 40)
        offenders.push(`freq-${i}: first at ${first?.y}`);
      kickers += ramps.filter((r) => r.kind === 'kicker').length;
      all += ramps.length;
    }
    expect(offenders).toEqual([]);
    expect(kickers / all).toBeGreaterThan(0.7);
    expect(kickers / all).toBeLessThan(0.9);
  });

  it('keeps jumps fair: room after each landing, off risk lanes, run-ups free of ice and drifts', () => {
    const offenders: string[] = [];
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      const batch = s.advance(START_Y + 60000);
      batch.ramps.forEach((r, i) => {
        const next = batch.ramps[i + 1];
        const zone = maxFlightPx(topSpeed((r.y - START_Y) / PX_PER_M), r.kind === 'cliff') + 109;
        if (next && next.line !== 0 && next.line === r.line) {
          // Inside a line: past the top-speed landing zone there is still a clear run-up to the next lip,
          // and the kickers match, so the line reads as one thing.
          if (next.y - (r.y + zone) < LINE_RUNUP_MIN)
            offenders.push(`${seed} ${r.id}: no run-up to the next line kicker`);
          if (next.x !== r.x || next.half !== r.half || next.lineIdx !== r.lineIdx + 1)
            offenders.push(`${seed} ${r.id}: line kickers do not match`);
        } else if (next && next.y - r.landEnd < JUMP_GAP_MIN) {
          // The next lip comes well after this landing zone ends, so a rider can line up again.
          offenders.push(`${seed} ${r.id}: next jump too close`);
        }
        // The gap to the next lip is always longer than this jump's landing zone.
        if (next && next.y - r.y <= zone) offenders.push(`${seed} ${r.id}: gap shorter than zone`);
        for (const l of s.lanes) {
          if (l.y1 >= r.y - 60 && l.y0 <= r.landEnd + 60)
            offenders.push(`${seed} ${r.id}: on a lane`);
        }
        for (const p of batch.patches) {
          if (Math.abs(p.y - r.y) < p.ry + 40)
            offenders.push(`${seed} ${r.id}: patch ${p.id} at the lip`);
          // A line's run-ups are plain snow too, so ice or a drift never breaks it.
          if (r.lineIdx < r.lineLen - 1 && p.y + p.ry > r.y && p.y - p.ry < r.landEnd)
            offenders.push(`${seed} ${r.id}: patch ${p.id} inside a line`);
        }
        // A kicker sits inside the open path, so riding the path lines you up with it.
        const distM = (r.y - START_Y) / PX_PER_M;
        if (r.kind === 'kicker' && r.half > pathHalfWidth(distM) + 1) {
          offenders.push(`${seed} ${r.id}: kicker wider than the path`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('lets a path-following bot take off about every 4 s, every 110 m or so', () => {
    let launches = 0;
    let metres = 0;
    let seconds = 0;
    for (const seed of seeds.slice(0, 6)) {
      const sim = new Sim(seed);
      sim.begin();
      for (let i = 0; i < 120 * 90 && !sim.crashed; i++) {
        sim.step(botInput(sim));
        for (const e of sim.events) if (e.type === 'launch') launches++;
      }
      metres += sim.distM;
      seconds += sim.runTime;
    }
    // Before jump lines and the shorter gaps the same bot took off every 6.6 s, about every 250 m.
    expect(seconds / launches).toBeLessThan(4.5);
    expect(metres / launches).toBeLessThan(150);
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
        const blocked: string[] = [];
        for (const o of batch.obstacles) {
          const box = obstacleBox(o);
          if (!box || o.y < lane.y0 || o.y > lane.y1) continue;
          const lx = s.laneX(lane, o.y);
          const w = (box.x1 - box.x0) / 2;
          if (Math.abs(o.x - lx) < LANE_HALF + w + 2) blocked.push(`corridor ${o.x},${o.y}`);
          // the strip between the main path and the lane stays open at both ends
          if (o.y < lane.y0 + 38 || o.y > lane.y1 - 38) {
            const c = s.pathCenter(o.y);
            const lo = Math.min(c, lx) - LANE_HALF;
            const hi = Math.max(c, lx) + LANE_HALF;
            if (!(o.x + w < lo || o.x - w > hi)) blocked.push(`strip ${o.x},${o.y}`);
          }
        }
        expect(blocked).toEqual([]);
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
      const buried: string[] = [];
      for (const star of batch.pickups) {
        for (const o of batch.obstacles) {
          const box = obstacleBox(o);
          if (!box || o.y < star.y - 30 || o.y > star.y + 30) continue;
          if (!star.lane) continue;
          if (circleHitsBox(star.x, star.y, 2, box)) buried.push(`${star.x},${star.y}`);
        }
      }
      expect(buried).toEqual([]);
    }
  });

  it('stays winnable at maximum speed and high distance, with jumps and drifts', () => {
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
      // Fingerprints taken when batches still carried empty `gates` and `props` lists and lane star
      // ids started at 1,000,000, so those are put back here. Refreshed on purpose only when the course
      // design changes (last: a jump every ~85 m instead of ~150 m, jump lines, lanes fitted between jumps), never to get green.
      const old = {
        obstacles: b.obstacles,
        pickups: b.pickups.map((p) => ({ ...p, id: p.id + 999_999 })),
        gates: [],
        ramps: b.ramps,
        patches: b.patches,
        props: [],
      };
      return [hashSeed(JSON.stringify(old)), b.obstacles.length, b.ramps.length];
    };
    expect(fp('alpha')).toEqual([2402853442, 726, 28]);
    expect(fp('k3m9qa')).toEqual([1247566756, 674, 31]);
  });
});
