import { PX_PER_M, START_X, START_Y, W } from '../config';
import { obstacleBox } from '../collision';
import { Rng } from '../rng';
import type { Gate, Obstacle, ObstacleKind, Pickup, SpawnBatch } from './types';

/** Nothing spawns in the rows right below the start gate. */
export const FIRST_ROW_Y = START_Y + 70;
/** Until this y the open lane stays dead straight under the rider. */
export const SAFE_LANE_END_Y = START_Y + 300;
/** Vertical size of one "lane" segment; the open path wanders from one segment to the next. */
const BAND = 80;
/** Largest sideways move of the open path between two segments. */
const MAX_DRIFT = 36;
const PATH_MARGIN = 36;
const FIRST_GATE_Y = START_Y + 700;
const GATE_EVERY = 900;

/** Half width of the guaranteed open path at a given distance (shrinks as the run gets harder). */
export function pathHalfWidth(distM: number): number {
  return 17 + 13 * Math.exp(-distM / 1200);
}

/** Chance of an obstacle in a row, rising with distance. */
export function density(distM: number): number {
  return 0.34 + 0.4 * (1 - Math.exp(-distM / 1500));
}

interface SpritePick {
  kind: ObstacleKind;
  size: number;
  half: number;
}

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

/**
 * Deterministic, endless course generator. All randomness comes from one seeded stream consumed in
 * a fixed order, so the world is identical for a given seed no matter how `advance` is chunked.
 */
export class Spawner {
  // Independent streams, so the order in which rows, stars and path bands are requested never
  // changes what a given seed produces.
  private readonly rng: Rng;
  private readonly bandRng: Rng;
  private readonly starRng: Rng;
  private nextY = FIRST_ROW_Y;
  private nextObstacleId = 1;
  private nextPickupId = 1;
  private nextGateId = 1;
  private nextGateY = FIRST_GATE_Y;
  private nextStarY = FIRST_ROW_Y + 60;
  private readonly bands: number[] = [START_X];
  private recent: Obstacle[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.bandRng = new Rng(seed ^ 0x9e3779b9);
    this.starRng = new Rng(seed ^ 0x7f4a7c15);
  }

  /** Centre x of the guaranteed open path at world y. */
  pathCenter(y: number): number {
    if (y <= SAFE_LANE_END_Y) return START_X;
    const f = (y - SAFE_LANE_END_Y) / BAND;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    const a = this.band(i);
    const b = this.band(i + 1);
    return a + (b - a) * s;
  }

  private band(i: number): number {
    while (this.bands.length <= i) {
      const prev = this.bands[this.bands.length - 1] ?? START_X;
      const next = Math.min(
        W - PATH_MARGIN,
        Math.max(PATH_MARGIN, prev + this.bandRng.range(-MAX_DRIFT, MAX_DRIFT)),
      );
      this.bands.push(next);
    }
    return this.bands[i] ?? START_X;
  }

  /** Spawn everything above world y `toY` that has not been spawned yet. */
  advance(toY: number): SpawnBatch {
    const batch: SpawnBatch = { obstacles: [], pickups: [], gates: [] };
    while (this.nextY < toY) {
      this.spawnRow(this.nextY, batch);
      this.nextY += this.rng.range(9, 15);
    }
    while (this.nextGateY < toY) {
      batch.gates.push(this.makeGate(this.nextGateY));
      this.nextGateY += GATE_EVERY;
    }
    while (this.nextStarY < toY) {
      this.spawnStars(this.nextStarY, batch);
      this.nextStarY += this.starRng.range(110, 190);
    }
    return batch;
  }

  private spawnRow(y: number, batch: SpawnBatch): void {
    const distM = (y - START_Y) / PX_PER_M;
    const gap = pathHalfWidth(distM);
    const center = this.pathCenter(y);
    const tries = this.rng.chance(density(distM)) ? 1 + (this.rng.chance(0.45) ? 1 : 0) : 0;
    for (let t = 0; t < tries; t++) this.tryObstacle(y, distM, gap, center, batch);
    // A denser forest hugs both sides of the slope.
    if (this.rng.chance(0.55)) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      const x = side < 0 ? this.rng.range(8, 24) : this.rng.range(W - 24, W - 8);
      this.tryObstacle(y, distM, gap, center, batch, x);
    }
  }

  private tryObstacle(
    y: number,
    distM: number,
    gap: number,
    center: number,
    batch: SpawnBatch,
    forcedX?: number,
  ): void {
    const x = Math.round(forcedX ?? this.rng.range(10, W - 10));
    const pick = pickSprite(this.rng, distM);
    const probe: Obstacle = {
      id: 0,
      kind: pick.kind,
      size: pick.size,
      variant: this.rng.int(0, 3),
      x,
      y: Math.round(y + this.rng.range(-3, 3)),
      half: pick.half,
      judged: false,
      touched: false,
    };
    // Never block the open path (pebbles are harmless, so they may sit on it).
    const box = obstacleBox(probe);
    if (box) {
      const w = (box.x1 - box.x0) / 2;
      if (Math.abs(x - center) < gap + w + 2) return;
    }
    if (x - probe.half < 1 || x + probe.half > W - 2) return;
    for (const o of this.recent) {
      if (Math.abs(o.x - x) < o.half + probe.half && Math.abs(o.y - probe.y) < 14) return;
    }
    probe.id = this.nextObstacleId++;
    this.recent.push(probe);
    if (this.recent.length > 40) this.recent.shift();
    batch.obstacles.push(probe);
  }

  private spawnStars(y: number, batch: SpawnBatch): void {
    const distM = (y - START_Y) / PX_PER_M;
    const gap = pathHalfWidth(distM);
    const count = this.starRng.int(3, 5);
    const sway = this.starRng.range(0.4, 1) * Math.max(4, gap - 6);
    const phase = this.starRng.range(0, Math.PI);
    for (let i = 0; i < count; i++) {
      const sy = y + i * 14;
      const sx = this.pathCenter(sy) + Math.sin(phase + i * 0.9) * sway;
      const pickup: Pickup = {
        id: this.nextPickupId++,
        x: Math.round(sx),
        y: Math.round(sy),
        taken: false,
      };
      batch.pickups.push(pickup);
    }
  }

  private makeGate(y: number): Gate {
    const distM = (y - START_Y) / PX_PER_M;
    return {
      id: this.nextGateId++,
      x: Math.round(this.pathCenter(y)),
      y,
      half: Math.round(pathHalfWidth(distM)),
      passed: false,
      success: false,
    };
  }
}
