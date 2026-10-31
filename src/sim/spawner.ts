import { PX_PER_M, START_X, START_Y, W } from '../core/config';
import { detExp } from '../core/detMath';
import { obstacleBox } from './collision';
import { maxFlightPx, topSpeed } from './speed';
import { Rng } from '../core/rng';
import type { CliffSeg, Obstacle, ObstacleKind, Patch, Ramp, SpawnBatch } from './types';

/** Nothing spawns in the rows right below the start gate. */
export const FIRST_ROW_Y = START_Y + 70;
/** Until this y the open lane stays dead straight under the rider. */
export const SAFE_LANE_END_Y = START_Y + 300;
/** Largest sideways move of the open path between two segments, near the start and far down. */
const DRIFT_NEAR = 36;
const DRIFT_FAR = 24;
/** Vertical size of a "segment" of the open path, near the start and far down. Longer segments give a fast rider room to react. */
const BAND_NEAR = 80;
const BAND_FAR = 150;
const PATH_MARGIN = 36;

/** Half width of the risk lane corridor, and how far outside the main path edge it runs. */
export const LANE_HALF = 6;
const LANE_OFFSET = 20;
const LANE_END_STRIP = 38;
const LANE_STAR_STEP = 13;
const RAMP_HALF = 13;
/** Roughly two in five of the jumps are cliffs: a rock ledge across the whole slope that you drop off. */
const CLIFF_CHANCE = 0.4;
/** Chance per row of a tree or rock hugging the slope edge. */
const SIDE_FOREST_CHANCE = 0.55;
/** Extra solid-free ground after the furthest possible landing, so a rider has room to steer back to the path. */
const LANDING_MARGIN = 110;
const FIRST_RAMP_Y = START_Y + 900;
const FIRST_LANE_Y = START_Y + 1500;
const FIRST_PATCH_Y = START_Y + 800;

/**
 * Half width of the guaranteed open path at a given distance. It narrows as the run gets harder,
 * but stays wider than it used to at speed, because a faster rider needs more room to turn in.
 */
export function pathHalfWidth(distM: number): number {
  const top = topSpeed(distM);
  const speedRoom = 7 * Math.min(1, Math.max(0, (top - 180) / 160));
  return 17 + 13 * detExp(-distM / 1200) + speedRoom;
}

/** Chance of an obstacle in a row, rising with distance. */
export function density(distM: number): number {
  return 0.34 + 0.4 * (1 - detExp(-distM / 1500));
}

function bandLength(i: number): number {
  return BAND_NEAR + (BAND_FAR - BAND_NEAR) * (1 - detExp(-i / 14));
}

function bandDrift(i: number): number {
  return DRIFT_NEAR + (DRIFT_FAR - DRIFT_NEAR) * (1 - detExp(-i / 14));
}

interface SpritePick {
  kind: ObstacleKind;
  size: number;
  half: number;
}

/** The mountain's obstacle mix. Its roll thresholds are part of what makes old seeds reproducible. */
function pickSprite(rng: Rng, distM: number): SpritePick {
  const r = rng.next();
  if (r < 0.16) return { kind: 'tree', size: rng.int(9, 13), half: 6 };
  if (r < 0.38) return { kind: 'tree', size: rng.int(18, 26), half: 9 };
  if (r < 0.5) return { kind: 'tree', size: rng.int(30, 38), half: 12 };
  if (r < 0.58) return { kind: 'bush', size: 1, half: 9 };
  if (r < 0.64) return { kind: 'dead', size: rng.int(14, 22), half: 6 };
  if (r < 0.78) return { kind: 'rock', size: rng.int(5, 8), half: 5 }; // pebble, decoration only
  if (r < 0.93 || distM < 60) return { kind: 'rock', size: rng.int(11, 16), half: 9 };
  return { kind: 'rock', size: rng.int(20, 26), half: 14 }; // boulder
}

/** A narrow side line next to the main path, lined with a trail of high value stars. */
export interface Lane {
  y0: number;
  y1: number;
  /** -1: left of the main path, +1: right of it. */
  side: -1 | 1;
}

/**
 * Deterministic, endless course generator. Every kind of feature draws from its own seeded stream
 * in a fixed order, so the world is identical for a given seed no matter how `advance` is chunked.
 *
 * Invariants kept for every seed (see tests/spawner.test.ts): the guaranteed open path is never
 * blocked by a solid obstacle; ramps sit on the path and have a solid-free landing zone sized for
 * the fastest speed possible at that distance; risk lanes have free entry and exit strips and a
 * corridor of their own.
 */
export class Spawner {
  // Independent streams, so the order in which rows and path bands are requested never
  // changes what a given seed produces.
  private readonly rng: Rng;
  private readonly bandRng: Rng;
  private readonly rampRng: Rng;
  private readonly patchRng: Rng;
  private readonly laneRng: Rng;
  private readonly hugRng: Rng;
  private nextY = FIRST_ROW_Y;
  private nextObstacleId = 1;
  private nextPickupId = 1;
  private nextRampId = 1;
  private nextPatchId = 1;
  private nextRampY = FIRST_RAMP_Y;
  private nextPatchY = FIRST_PATCH_Y;
  private nextLaneY = FIRST_LANE_Y;
  private nextLaneStarLane = 0;
  private nextRampOut = 0;
  private nextPatchOut = 0;
  private readonly bands: number[] = [START_X];
  /** Start y of each path band (bandStart[i] is where band i begins). */
  private readonly bandStart: number[] = [SAFE_LANE_END_Y];
  private recent: Obstacle[] = [];
  /** Planned features, in order of y. Public for the renderer, the sim and tests. */
  readonly lanes: Lane[] = [];
  readonly ramps: Ramp[] = [];
  readonly patches: Patch[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.bandRng = new Rng(seed ^ 0x9e3779b9);
    this.rampRng = new Rng(seed ^ 0x2545f491);
    this.patchRng = new Rng(seed ^ 0x51ed270b);
    this.laneRng = new Rng(seed ^ 0x6c8e9cf5);
    this.hugRng = new Rng(seed ^ 0x3c6ef372);
  }

  /** Centre x of the guaranteed open path at world y. */
  pathCenter(y: number): number {
    if (y <= SAFE_LANE_END_Y) return START_X;
    this.ensureBandAt(y);
    // Bands are searched from the back: queries are mostly near the newest bands.
    let i = this.bandStart.length - 1;
    while (i > 0 && (this.bandStart[i] ?? 0) > y) i--;
    const a0 = this.bandStart[i] ?? SAFE_LANE_END_Y;
    const t = (y - a0) / bandLength(i);
    const s = t * t * (3 - 2 * t);
    const a = this.band(i);
    const b = this.band(i + 1);
    return a + (b - a) * s;
  }

  private ensureBandAt(y: number): void {
    while ((this.bandStart[this.bandStart.length - 1] ?? 0) <= y) {
      const i = this.bandStart.length - 1;
      this.bandStart.push((this.bandStart[i] ?? 0) + bandLength(i));
    }
    // pathCenter reads band i + 1 too.
    this.band(this.bandStart.length);
  }

  private band(i: number): number {
    while (this.bands.length <= i) {
      const n = this.bands.length;
      const prev = this.bands[n - 1] ?? START_X;
      const d = bandDrift(n - 1);
      const next = Math.min(
        W - PATH_MARGIN,
        Math.max(PATH_MARGIN, prev + this.bandRng.range(-d, d)),
      );
      this.bands.push(next);
    }
    return this.bands[i] ?? START_X;
  }

  /** The lane covering world y, if any. */
  laneAt(y: number): Lane | null {
    for (const l of this.lanes) if (y >= l.y0 && y <= l.y1) return l;
    return null;
  }

  /** Centre x of a lane's star line at world y. */
  laneX(lane: Lane, y: number): number {
    const distM = (y - START_Y) / PX_PER_M;
    const x = this.pathCenter(y) + lane.side * (pathHalfWidth(distM) + LANE_OFFSET);
    return Math.min(W - 12, Math.max(12, x));
  }

  /** Spawn everything above world y `toY` that has not been spawned yet. */
  advance(toY: number): SpawnBatch {
    const batch: SpawnBatch = {
      obstacles: [],
      pickups: [],
      ramps: [],
      patches: [],
    };
    this.planLanes(toY + 60);
    this.planRamps(toY + 60);
    this.planPatches(toY + 60);
    while (this.nextY < toY) {
      this.spawnRow(this.nextY, batch);
      this.nextY += this.rng.range(9, 15);
    }
    while (this.nextLaneStarLane < this.lanes.length) {
      const lane = this.lanes[this.nextLaneStarLane];
      if (!lane || lane.y1 - LANE_END_STRIP >= toY) break;
      this.spawnLaneStars(lane, batch);
      this.nextLaneStarLane++;
    }
    while (this.nextRampOut < this.ramps.length) {
      const r = this.ramps[this.nextRampOut];
      if (!r || r.y >= toY) break;
      batch.ramps.push(r);
      this.nextRampOut++;
    }
    while (this.nextPatchOut < this.patches.length) {
      const p = this.patches[this.nextPatchOut];
      if (!p || p.y >= toY) break;
      batch.patches.push(p);
      this.nextPatchOut++;
    }
    return batch;
  }

  /** Plan risk lanes up to world y `limit`. Depends only on the lane stream and the path, never on other features. */
  private planLanes(limit: number): void {
    while (this.nextLaneY <= limit) {
      const y0 = Math.round(this.nextLaneY + this.laneRng.range(0, 200));
      const len = Math.round(this.laneRng.range(210, 270));
      const prefer = this.laneRng.chance(0.5) ? 1 : -1;
      this.nextLaneY = y0 + len + this.laneRng.range(1000, 1600);
      const side = this.laneSide(y0, y0 + len, prefer);
      if (side) this.lanes.push({ y0, y1: y0 + len, side });
    }
  }

  /** A side with room for the whole lane (and the strips leading to it), or null if there is none. */
  private laneSide(y0: number, y1: number, prefer: 1 | -1): (1 | -1) | null {
    const sides: Array<1 | -1> = prefer === 1 ? [1, -1] : [-1, 1];
    for (const side of sides) {
      let ok = true;
      for (let y = y0; y <= y1 && ok; y += 10) {
        const distM = (y - START_Y) / PX_PER_M;
        const x = this.pathCenter(y) + side * (pathHalfWidth(distM) + LANE_OFFSET);
        if (x < 20 || x > W - 20) ok = false;
      }
      if (ok) return side;
    }
    return null;
  }

  private nearLane(y: number, pad: number): boolean {
    for (const l of this.lanes) if (y >= l.y0 - pad && y <= l.y1 + pad) return true;
    return false;
  }

  /** Plan kickers up to `limit`. Each gets a solid-free landing zone sized for the fastest rider at that distance. */
  private planRamps(limit: number): void {
    while (this.nextRampY <= limit) {
      const y = Math.round(this.nextRampY + this.rampRng.range(0, 150));
      this.nextRampY = y + this.rampRng.range(1200, 1800);
      const distM = (y - START_Y) / PX_PER_M;
      const cliff = this.rampRng.chance(CLIFF_CHANCE);
      const landEnd = Math.round(y + maxFlightPx(topSpeed(distM), cliff) + LANDING_MARGIN);
      this.planLanes(landEnd + 60);
      if (this.nearLane(y, 60) || this.nearLane(landEnd, 60)) continue;
      const segs = cliff ? this.cliffSegs() : [];
      const seed = cliff ? this.rampRng.int(1, 100000) : 0;
      this.ramps.push({
        id: this.nextRampId++,
        kind: cliff ? 'cliff' : 'kicker',
        x: cliff ? W / 2 : Math.round(this.pathCenter(y)),
        y,
        half: cliff ? W / 2 : RAMP_HALF,
        landEnd,
        used: false,
        seed,
        segs,
      });
    }
  }

  /**
   * The rock of a cliff. Usually a broken ledge: 2-4 chunks at slightly different heights with open
   * slope between them. Sometimes just one chunk hugging a side of the screen, leaving the rest open.
   */
  private cliffSegs(): CliffSeg[] {
    const rng = this.rampRng;
    if (rng.chance(0.35)) {
      const w = Math.round(rng.range(50, 86));
      const left = rng.chance(0.5);
      return [{ x0: left ? 0 : W - w, x1: left ? w : W, dy: Math.round(rng.range(-4, 4)) }];
    }
    const segs: CliffSeg[] = [];
    let x = Math.round(rng.range(-10, 8));
    while (x < W) {
      const w = Math.round(rng.range(24, 58));
      const x0 = Math.max(0, x);
      const x1 = Math.min(W, x + w);
      if (x1 - x0 >= 12) segs.push({ x0, x1, dy: Math.round(rng.range(-7, 7)) });
      x += w + Math.round(rng.range(12, 26));
    }
    return segs;
  }

  /** Plan ice patches and snowdrifts up to `limit`. */
  private planPatches(limit: number): void {
    while (this.nextPatchY <= limit) {
      const y = Math.round(this.nextPatchY + this.patchRng.range(0, 120));
      this.nextPatchY = y + this.patchRng.range(230, 400);
      const ice = this.patchRng.chance(0.45);
      const onPath = this.patchRng.chance(0.3);
      const rx = Math.round(ice ? this.patchRng.range(18, 32) : this.patchRng.range(15, 26));
      const ry = Math.round(ice ? this.patchRng.range(16, 26) : this.patchRng.range(12, 20));
      const side = this.patchRng.chance(0.5) ? 1 : -1;
      const slack = this.patchRng.range(0, 24);
      const variant = this.patchRng.int(0, 3);
      this.planLanes(y + ry + 80);
      if (this.nearLane(y, ry + 30)) continue;
      const distM = (y - START_Y) / PX_PER_M;
      const centre = this.pathCenter(y);
      let x: number;
      if (onPath) {
        // Ice on the path only where the path is nearly straight, so a loose board can still hold the line.
        if (ice && Math.abs(this.pathCenter(y - ry) - this.pathCenter(y + ry)) > 12) continue;
        x = centre + side * Math.min(8, slack / 3);
      } else {
        x = centre + side * (pathHalfWidth(distM) + rx + 4 + slack);
      }
      if (x < rx * 0.5 || x > W - rx * 0.5) x = Math.min(W - rx * 0.5, Math.max(rx * 0.5, x));
      this.patches.push({
        id: this.nextPatchId++,
        kind: ice ? 'ice' : 'drift',
        x: Math.round(x),
        y,
        rx,
        ry,
        variant,
      });
    }
  }

  private spawnRow(y: number, batch: SpawnBatch): void {
    const distM = (y - START_Y) / PX_PER_M;
    const gap = pathHalfWidth(distM);
    const center = this.pathCenter(y);
    const tries = this.rng.chance(density(distM)) ? 1 + (this.rng.chance(0.45) ? 1 : 0) : 0;
    for (let t = 0; t < tries; t++) this.tryObstacle(y, distM, gap, center, batch);
    // A denser forest hugs both sides of the slope.
    if (this.rng.chance(SIDE_FOREST_CHANCE)) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      const x = side < 0 ? this.rng.range(8, 24) : this.rng.range(W - 24, W - 8);
      this.tryObstacle(y, distM, gap, center, batch, x);
    }
    // Trees press in on both sides of a risk lane, which is what makes it risky.
    const lane = this.laneAt(y);
    if (lane && y > lane.y0 + LANE_END_STRIP && y < lane.y1 - LANE_END_STRIP) {
      if (this.hugRng.chance(0.55)) {
        const side = this.hugRng.chance(0.5) ? 1 : -1;
        this.tryObstacle(y, distM, gap, center, batch, undefined, { lane, side }, this.hugRng);
      }
    }
  }

  /** True when a solid obstacle with this half width at (x, y) would break a guarantee. */
  private blocked(x: number, y: number, w: number, gap: number, center: number): boolean {
    // The main open path.
    if (Math.abs(x - center) < gap + w + 2) return true;
    // Landing zones: no solid obstacles anywhere across the slope.
    for (const r of this.ramps) {
      if (y >= r.y - 14 && y <= r.landEnd) return true;
      if (r.y > y + 400) break;
    }
    // Risk lanes: the lane itself, plus the strips that lead into and out of it.
    const lane = this.laneAt(y);
    if (lane) {
      const lx = this.laneX(lane, y);
      if (Math.abs(x - lx) < LANE_HALF + w + 2) return true;
      if (y < lane.y0 + LANE_END_STRIP || y > lane.y1 - LANE_END_STRIP) {
        const lo = Math.min(center, lx) - LANE_HALF;
        const hi = Math.max(center, lx) + LANE_HALF;
        if (x + w + 2 > lo && x - w - 2 < hi) return true;
      }
    }
    return false;
  }

  private tryObstacle(
    y: number,
    distM: number,
    gap: number,
    center: number,
    batch: SpawnBatch,
    forcedX?: number,
    hug?: { lane: Lane; side: 1 | -1 },
    rng: Rng = this.rng,
  ): void {
    let x = Math.round(forcedX ?? rng.range(10, W - 10));
    const pick = pickSprite(rng, distM);
    const probe: Obstacle = {
      id: 0,
      kind: pick.kind,
      size: pick.size,
      variant: rng.int(0, 3),
      x,
      y: Math.round(y + rng.range(-3, 3)),
      half: pick.half,
      judged: false,
      touched: false,
    };
    const box = obstacleBox(probe);
    const w = box ? (box.x1 - box.x0) / 2 : 0;
    if (hug) {
      x = Math.round(this.laneX(hug.lane, probe.y) + hug.side * (LANE_HALF + w + 3));
      probe.x = x;
    }
    // Never block the open path (pebbles are harmless, so they may sit on it).
    if (box && this.blocked(x, probe.y, w, gap, center)) return;
    if (x - probe.half < 1 || x + probe.half > W - 2) return;
    for (const o of this.recent) {
      if (Math.abs(o.x - x) < o.half + probe.half && Math.abs(o.y - probe.y) < 14) return;
    }
    probe.id = this.nextObstacleId++;
    this.recent.push(probe);
    if (this.recent.length > 40) this.recent.shift();
    batch.obstacles.push(probe);
  }

  private spawnLaneStars(lane: Lane, batch: SpawnBatch): void {
    for (let y = lane.y0 + LANE_END_STRIP; y <= lane.y1 - LANE_END_STRIP; y += LANE_STAR_STEP) {
      batch.pickups.push({
        id: this.nextPickupId++,
        x: Math.round(this.laneX(lane, y)),
        y: Math.round(y),
        taken: false,
        value: 30,
        lane: true,
      });
    }
  }
}
