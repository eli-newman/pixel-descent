import {
  avalancheDanger,
  createAvalanche,
  isBuried,
  stepAvalanche,
  type Avalanche,
} from './avalanche';
import { clearance, crossedY, NEAR_MISS_PX, riderCenter, testObstacle } from './collision';
import { EDGE, H, STEP, W, START_Y } from './config';
import {
  BAIL_HX,
  CLEAN_HX,
  createRider,
  cruiseSpeed,
  launch,
  speedMultiplier,
  startTrick,
  stepRider,
  topSpeed,
  tuckFraction,
  type RiderState,
  type Surface,
} from './rider';
import { hashSeed } from './rng';
import {
  addDistance,
  addGate,
  addNearMiss,
  addStar,
  addTrick,
  breakCombo,
  comboLeft,
  createScore,
  distanceMeters,
  totalScore,
  type ScoreState,
} from './score';
import { Trail } from './trail';
import { Spawner } from './world/spawner';
import type { Gate, Obstacle, Patch, Pickup, Ramp } from './world/types';

/** One step of player input. `steer` is quantised in the sim, so a replay reproduces a run exactly. */
export interface SimInput {
  steer: number;
  /** True only on the step the trick button went down. */
  trick: boolean;
}

export interface SimOptions {
  /** Touch controls steer less precisely, so the avalanche is a little gentler. */
  touch?: boolean;
  /** Tests only: hold the rider at the top speed for the current distance. */
  forceSpeed?: boolean;
  /** Tests only: leave the avalanche out. */
  noAvalanche?: boolean;
}

export type CrashCause = 'obstacle' | 'bail' | 'avalanche';

export type SimEvent =
  | { type: 'star'; x: number; y: number; value: number; lane: boolean }
  | { type: 'near'; pts: number; combo: number }
  | { type: 'gate'; ok: boolean; pts: number; x: number }
  | { type: 'bush'; x: number; y: number }
  | { type: 'launch' }
  | { type: 'trick'; n: number }
  | { type: 'land'; quality: 'clean' | 'sloppy'; pts: number; tricks: number }
  | { type: 'crash'; cause: CrashCause };

/** Seconds of tumbling before a run is over. */
export const CRASH_TIME = 1.25;
const PICKUP_RADIUS = 7;
const TRAIL_SPACING = 1.5;
/** Steering is held to multiples of this, which is what makes input scripts and replays exact. */
export const STEER_STEPS = 8;
/** Touch riders get a slightly slower avalanche. */
export const TOUCH_AVALANCHE_EASE = 0.92;
const GATE_SLACK = 2;
/** How far (px) the sim keeps the world generated below the rider, plus a share of the rider's speed. */
const SPAWN_BASE = H + 90;
const SPAWN_PER_SPEED = 0.12;

export function quantiseSteer(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  return Math.round(c * STEER_STEPS) / STEER_STEPS;
}

/** Remove, in place, every element a predicate rejects. No new array is made. */
export function compact<T>(arr: T[], keep: (t: T) => boolean): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (keep(v)) arr[w++] = v;
  }
  arr.length = w;
}

/** Insert into an array kept sorted by y. New items nearly always belong at the end. */
function insertByY(arr: Obstacle[], o: Obstacle): void {
  let i = arr.length;
  arr.push(o);
  while (i > 0 && arr[i - 1].y > o.y) {
    arr[i] = arr[i - 1];
    i--;
  }
  arr[i] = o;
}

/**
 * The whole game rules, with no DOM, no audio and no clock: feed it a seed and a stream of
 * inputs at the fixed step and it always produces the same run. The Game shell, the ghost replay
 * and the tests all run this same class.
 */
export class Sim {
  readonly spawner: Spawner;
  readonly rider: RiderState = createRider();
  readonly score: ScoreState = createScore();
  readonly avalanche: Avalanche = createAvalanche();
  readonly trail = new Trail(420);
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  gates: Gate[] = [];
  ramps: Ramp[] = [];
  patches: Patch[] = [];
  /** Events of the latest step. Cleared at the start of each step; read them right after. */
  readonly events: SimEvent[] = [];

  steps = 0;
  /** Seconds of riding in this run. */
  runTime = 0;
  /** Deepest y reached, so distance never shrinks when the rider recoils from a crash. */
  maxY = START_Y;
  crashed = false;
  crashT = 0;
  crashCause: CrashCause = 'obstacle';
  crashFace: 1 | -1 = -1;
  /** The obstacle that ended the run, if one did. */
  killer: Obstacle | null = null;
  /** Where the rider was when the run ended. */
  crashX = 0;
  crashY = 0;
  /** Seconds spent at 90 percent or more of the tuck range (for the "send it" achievement). */
  sendItTime = 0;
  topSpeedSeen = 0;
  /** Current surface under the rider. */
  readonly surface: Surface = { ice: false, drift: false };
  bushHits = 0;
  private crashVx = 0;
  private crashVy = 0;
  private lastLaneStarAt = -Infinity;
  private started = false;

  constructor(
    readonly seed: string,
    readonly opts: SimOptions = {},
  ) {
    this.spawner = new Spawner(hashSeed(seed));
    this.rider.speed = 0;
    this.spawn();
  }

  get distM(): number {
    return distanceMeters(this.maxY);
  }

  get scoreValue(): number {
    return totalScore(this.score);
  }

  /** 0 at cruising speed, 1 at the top speed for this distance. */
  get tuck(): number {
    return tuckFraction(this.rider.speed, this.distM);
  }

  get mult(): number {
    return speedMultiplier(this.tuck);
  }

  get danger(): number {
    return avalancheDanger(this.avalanche, this.rider.y);
  }

  get gap(): number {
    return this.rider.y - this.avalanche.y;
  }

  get comboLeft(): number {
    return comboLeft(this.score, this.runTime);
  }

  /** Let go of the start: the rider begins moving. */
  begin(): void {
    this.started = true;
    this.rider.speed = 30;
  }

  /** Advance one fixed step. */
  step(input: SimInput, dt: number = STEP): void {
    this.events.length = 0;
    if (!this.started) return;
    this.steps++;
    if (this.crashed) {
      this.stepCrash(dt);
      return;
    }
    const r = this.rider;
    const dist = this.distM;
    const cruise = cruiseSpeed(dist);
    const top = topSpeed(dist);
    if (this.opts.forceSpeed) r.speed = top;
    this.updateSurface();
    if (input.trick) startTrick(r);
    const prev = riderCenter(r);
    stepRider(r, quantiseSteer(input.steer), dt, { cruise, top, surface: this.surface });
    const prevMax = this.maxY;
    this.maxY = Math.max(this.maxY, r.y);
    this.runTime += dt;
    addDistance(this.score, this.maxY - prevMax, this.mult);
    this.topSpeedSeen = Math.max(this.topSpeedSeen, r.speed);
    if (this.tuck >= 0.9) this.sendItTime += dt;

    if (r.trickDone) this.events.push({ type: 'trick', n: r.tricks });
    if (r.landed) this.land(top);
    if (this.crashed) return;

    const c = riderCenter(r);
    if (!r.air) this.checkRamps(prev.y, c.y);

    if (!this.opts.noAvalanche) {
      const ease = this.opts.touch ? TOUCH_AVALANCHE_EASE : 1;
      stepAvalanche(this.avalanche, r.y, r.speed, this.distM, dt, ease);
      if (isBuried(this.avalanche, r.y)) {
        this.startCrash('avalanche', null);
        return;
      }
    }

    this.spawn();
    this.recordTrail();
    if (!r.air && this.collide(prev.y, c.y)) return;
    this.collectPickups(c.x, c.y);
    this.passGates(prev.y, c.y);
    this.cull();
  }

  private spawn(): void {
    const batch = this.spawner.advance(
      this.rider.y + SPAWN_BASE + this.rider.speed * SPAWN_PER_SPEED,
    );
    for (const o of batch.obstacles) insertByY(this.obstacles, o);
    for (const p of batch.pickups) this.pickups.push(p);
    for (const g of batch.gates) this.gates.push(g);
    for (const ramp of batch.ramps) this.ramps.push(ramp);
    for (const p of batch.patches) this.patches.push(p);
  }

  private updateSurface(): void {
    const r = this.rider;
    const cy = r.y + 8;
    this.surface.ice = false;
    this.surface.drift = false;
    for (const p of this.patches) {
      if (Math.abs(p.y - cy) > p.ry) continue;
      const dx = (r.x - p.x) / p.rx;
      const dy = (cy - p.y) / p.ry;
      if (dx * dx + dy * dy >= 1) continue;
      if (p.kind === 'ice') this.surface.ice = true;
      else this.surface.drift = true;
    }
  }

  private checkRamps(prevY: number, curY: number): void {
    const r = this.rider;
    for (const ramp of this.ramps) {
      if (ramp.used || ramp.y < r.y - 40) continue;
      if (ramp.y > r.y + 60) break;
      if (!crossedY(prevY, curY, ramp.y)) continue;
      if (Math.abs(r.x - ramp.x) > ramp.half + 2) continue;
      ramp.used = true;
      launch(r);
      this.events.push({ type: 'launch' });
      return;
    }
  }

  /** Touch down: a clean landing pays for its tricks and keeps the speed, a sloppy one scrubs it, a bail crashes. */
  private land(top: number): void {
    const r = this.rider;
    const a = Math.abs(r.hx);
    const unfinished = r.trickT > 0;
    const tricks = r.tricks;
    r.air = false;
    r.trickT = 0;
    r.airT = 0;
    if (unfinished || a > BAIL_HX) {
      breakCombo(this.score);
      this.startCrash('bail', null);
      return;
    }
    if (a > CLEAN_HX) {
      r.speed = Math.max(40, r.speed * 0.6);
      breakCombo(this.score);
      this.events.push({ type: 'land', quality: 'sloppy', pts: 0, tricks: 0 });
      return;
    }
    let pts = 0;
    for (let n = 1; n <= tricks; n++) pts += addTrick(this.score, n, this.mult);
    this.score.landings += 1;
    r.speed = Math.min(top, r.speed + (tricks > 0 ? 16 : 6));
    this.events.push({ type: 'land', quality: 'clean', pts, tricks });
  }

  private collide(prevY: number, curY: number): boolean {
    const r = this.rider;
    for (const o of this.obstacles) {
      if (o.y < r.y - 30) continue;
      if (o.y > r.y + 50) break;
      const hit = testObstacle(r, o);
      if (hit === 'crash') {
        this.startCrash('obstacle', o);
        return true;
      }
      if (hit === 'slow' && !o.touched) {
        o.touched = true;
        this.bushHits++;
        r.speed = Math.max(28, r.speed * 0.55);
        this.events.push({ type: 'bush', x: r.x, y: r.y + 8 });
      }
      if (!o.judged && crossedY(prevY, curY, o.y)) {
        o.judged = true;
        const gap = clearance(r, o);
        if (gap !== null && gap <= NEAR_MISS_PX) {
          const pts = addNearMiss(this.score, this.runTime, this.mult);
          this.events.push({ type: 'near', pts, combo: this.score.combo });
        }
      }
    }
    return false;
  }

  private collectPickups(cx: number, cy: number): void {
    if (this.rider.air) return;
    for (const p of this.pickups) {
      if (p.taken || Math.abs(p.y - cy) > PICKUP_RADIUS) continue;
      if (Math.hypot(p.x - cx, p.y - cy) < PICKUP_RADIUS) {
        p.taken = true;
        addStar(this.score, p.lane);
        if (p.lane) this.lastLaneStarAt = this.runTime;
        this.events.push({ type: 'star', x: p.x, y: p.y, value: p.value, lane: p.lane });
      }
    }
  }

  private passGates(prevY: number, curY: number): void {
    const r = this.rider;
    for (const g of this.gates) {
      if (g.passed || !crossedY(prevY, curY, g.y)) continue;
      g.passed = true;
      if (Math.abs(r.x - g.x) < g.half + GATE_SLACK) {
        g.success = true;
        const pts = addGate(this.score);
        this.events.push({ type: 'gate', ok: true, pts, x: g.x });
      } else {
        this.events.push({ type: 'gate', ok: false, pts: 0, x: g.x });
      }
    }
  }

  private recordTrail(): void {
    const r = this.rider;
    if (r.air) return;
    const lx = this.trail.lastX();
    const ly = this.trail.lastY();
    if (Number.isNaN(lx) || Math.hypot(r.x - lx, r.y - ly) >= TRAIL_SPACING) {
      this.trail.push(r.x, r.y);
    }
  }

  /** Drop everything that has scrolled well above the rider. In place, so a run allocates almost nothing. */
  private cull(): void {
    const top = this.rider.y - 190;
    let drop = 0;
    while (drop < this.obstacles.length && this.obstacles[drop].y < top) drop++;
    if (drop > 0) this.obstacles.splice(0, drop);
    compact(this.pickups, (p) => p.y > top && !p.taken);
    compact(this.gates, (g) => g.y > top - 30);
    compact(this.ramps, (q) => q.landEnd > top);
    compact(this.patches, (p) => p.y + p.ry > top);
  }

  private startCrash(cause: CrashCause, o: Obstacle | null): void {
    const r = this.rider;
    this.crashed = true;
    this.crashT = 0;
    this.crashCause = cause;
    this.killer = o;
    this.crashFace = r.face;
    this.crashX = r.x;
    this.crashY = r.y;
    const away = o ? (r.x < o.x ? -1 : 1) : r.hx < 0 ? 1 : -1;
    this.crashVx = cause === 'avalanche' ? 0 : away * 22 + r.hx * 20;
    this.crashVy = cause === 'avalanche' ? 0 : -48;
    r.speed = 0;
    r.air = false;
    this.events.push({ type: 'crash', cause });
  }

  private stepCrash(dt: number): void {
    const r = this.rider;
    this.crashT += dt;
    r.x = Math.max(EDGE, Math.min(W - EDGE, r.x + this.crashVx * dt));
    r.y += this.crashVy * dt;
    const damp = Math.exp(-4.5 * dt);
    this.crashVx *= damp;
    this.crashVy *= damp;
    if (this.opts.noAvalanche !== true) {
      // The wall keeps rolling while the rider lies in the snow.
      this.avalanche.y += this.avalanche.speed * 0.5 * dt;
    }
  }

  get finished(): boolean {
    return this.crashed && this.crashT >= CRASH_TIME;
  }

  /** Seconds since a lane star was last taken (for the lane audio ladder). */
  get sinceLaneStar(): number {
    return this.runTime - this.lastLaneStarAt;
  }
}
