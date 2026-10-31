import { clearance, crossedY, NEAR_MISS_PX, riderCenter, testObstacle } from './collision';
import { EDGE, H, STEP, W, START_Y } from '../core/config';
import { touchDown, type LandEvent } from './landing';
import { poseOf } from './pose';
import { launch, stepRider } from './rider';
import { createRider, type RiderState, type Surface } from './riderState';
import { hashSeed } from '../core/rng';
import {
  addDistance,
  addNearMiss,
  addStar,
  comboLeft,
  createScore,
  distanceMeters,
  totalScore,
  type ScoreState,
} from './score';
import { cruiseSpeed, speedMultiplier, topSpeed, tuckFraction } from './speed';
import { Trail } from './trail';
import { Spawner } from './spawner';
import { startFlip, startSnap, startTrick } from './tricks';
import type { Obstacle, Patch, Pickup, Ramp } from './types';
import { addBatch, cullAbove, surfaceAt, takeRamp } from './world';

/** One step of player input. `steer` is quantised in the sim, so the same inputs reproduce a run exactly. */
export interface SimInput {
  steer: number;
  /**
   * True only on the step the trick button went down: spin a full turn (a half turn if that is all
   * the air allows), in the direction held, else the way the rider faces. In manual spin it snaps
   * an extra half turn instead. Holding left or right in
   * the air spins that way on its own, so the steer value doubles as the spin input.
   */
  trick: boolean;
  /** Left and right held together: the rider swings the board sideways and plows to a stop. */
  brake?: boolean;
  /**
   * Flip key: 1 is a backflip (up), -1 a frontflip (down), 0 none. A press (the step it goes from 0
   * to nonzero) starts a full flip in assisted mode, and holding keeps flipping while the air time
   * allows. In manual spin the held key pitches the rider and releasing holds the angle. Absent
   * means 0.
   */
  flip?: -1 | 0 | 1;
}

export interface SimOptions {
  /**
   * Manual spin: in the air the arrows turn the rider continuously (left counter-clockwise, right
   * clockwise) and he keeps whatever angle he is left at; TRICK snaps an extra half turn. Fixed for
   * the whole run.
   */
  manualSpin?: boolean;
  /** Tests only: hold the rider at the top speed for the current distance. */
  forceSpeed?: boolean;
}

export type CrashCause = 'obstacle' | 'bail';

export type SimEvent =
  | { type: 'star'; x: number; y: number; value: number; lane: boolean }
  | { type: 'near'; pts: number; combo: number }
  | { type: 'bush'; x: number; y: number }
  | { type: 'launch'; cliff: boolean }
  | { type: 'spin'; deg: number }
  /** A flip came to rest on a full turn in the air: `deg` is signed (positive is a backflip). */
  | { type: 'flip'; deg: number }
  | LandEvent
  | { type: 'crash'; cause: CrashCause };

/** Seconds of tumbling before a run is over. */
export const CRASH_TIME = 1.25;
const PICKUP_RADIUS = 7;
const TRAIL_SPACING = 1.5;
/** Steering is held to multiples of this, which is what makes input scripts exact. */
const STEER_STEPS = 8;
/** How far (px) the sim keeps the world generated below the rider, plus a share of the rider's speed. */
const SPAWN_BASE = H + 90;
const SPAWN_PER_SPEED = 0.12;

export function quantiseSteer(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  return Math.round(c * STEER_STEPS) / STEER_STEPS;
}

/**
 * The whole game rules, with no DOM, no audio and no clock: feed it a seed and a stream of
 * inputs at the fixed step and it always produces the same run. The Game shell and the tests both
 * run this same class.
 */
export class Sim {
  readonly spawner: Spawner;
  readonly rider: RiderState = createRider();
  readonly score: ScoreState = createScore();
  readonly trail = new Trail(420);
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  ramps: Ramp[] = [];
  /** True while airborne after a cliff drop, so a clean landing pays the drop bonus. */
  cliffJump = false;
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
  /** Seconds spent at 90 percent or more of the tuck range (for the "send it" achievement). */
  sendItTime = 0;
  topSpeedSeen = 0;
  /** Current surface under the rider. */
  readonly surface: Surface = { ice: false, drift: false };
  private crashVx = 0;
  private crashVy = 0;
  private prevFlip = 0;
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
    this.ride(input, dt);
  }

  /** One step of riding: input, physics, collisions and pickups. */
  private ride(input: SimInput, dt: number): void {
    const r = this.rider;
    const dist = this.distM;
    const cruise = cruiseSpeed(dist);
    const top = topSpeed(dist);
    if (this.opts.forceSpeed) r.speed = top;
    surfaceAt(this.patches, r.x, r.y, this.surface);
    if (input.trick) {
      const q = quantiseSteer(input.steer);
      const dir = q >= 0.5 ? 1 : q <= -0.5 ? -1 : r.spinDir !== 0 ? r.spinDir : r.face;
      if (this.opts.manualSpin) startSnap(r, dir);
      else startTrick(r, dir);
    }
    const flip = input.flip ?? 0;
    if (flip !== 0 && this.prevFlip === 0 && !this.opts.manualSpin) startFlip(r, flip);
    this.prevFlip = flip;
    const prev = riderCenter(r);
    stepRider(r, quantiseSteer(input.steer), dt, {
      cruise,
      top,
      surface: this.surface,
      flip,
      brake: input.brake === true,
      manual: this.opts.manualSpin === true,
    });
    const prevMax = this.maxY;
    this.maxY = Math.max(this.maxY, r.y);
    this.runTime += dt;
    addDistance(this.score, this.maxY - prevMax, this.mult);
    this.topSpeedSeen = Math.max(this.topSpeedSeen, r.speed);
    if (this.tuck >= 0.9) this.sendItTime += dt;

    if (r.spinDone > 0) this.events.push({ type: 'spin', deg: r.spinDone });
    if (r.flipDone !== 0) this.events.push({ type: 'flip', deg: r.flipDone });
    if (r.landed) this.land(top);
    if (this.crashed) return;

    const c = riderCenter(r);
    if (!r.air) this.checkRamps(prev.y, c.y);

    this.spawn();
    this.recordTrail();
    if (!r.air && this.collide(prev.y, c.y)) return;
    this.collectPickups(c.x, c.y);
    cullAbove(this, r.y - 190);
  }

  private spawn(): void {
    addBatch(
      this,
      this.spawner.advance(this.rider.y + SPAWN_BASE + this.rider.speed * SPAWN_PER_SPEED),
    );
  }

  private checkRamps(prevY: number, curY: number): void {
    const ramp = takeRamp(this.ramps, this.rider, prevY, curY);
    if (!ramp) return;
    this.cliffJump = ramp.kind === 'cliff';
    launch(this.rider, this.cliffJump);
    this.events.push({ type: 'launch', cliff: this.cliffJump });
  }

  /** Touch down: pay out the landing, or crash on a bail. */
  private land(top: number): void {
    const wasCliff = this.cliffJump;
    this.cliffJump = false;
    const landed = touchDown(this.rider, this.score, wasCliff, this.mult, top);
    if (landed) this.events.push(landed);
    else this.startCrash('bail', null);
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
        this.events.push({ type: 'star', x: p.x, y: p.y, value: p.value, lane: p.lane });
      }
    }
  }

  private recordTrail(): void {
    const r = this.rider;
    if (r.air) return;
    const lx = this.trail.lastX();
    const ly = this.trail.lastY();
    if (Number.isNaN(lx) || Math.hypot(r.x - lx, r.y - ly) >= TRAIL_SPACING) {
      if (r.brake > 0.15) {
        const n = poseOf(r, r.x, r.y, 0);
        this.trail.push(r.x, r.y, n.nx * r.brake, n.ny * r.brake);
      } else {
        this.trail.push(r.x, r.y);
      }
    }
  }

  private startCrash(cause: CrashCause, o: Obstacle | null): void {
    const r = this.rider;
    this.crashed = true;
    this.crashT = 0;
    this.crashCause = cause;
    this.killer = o;
    this.crashFace = r.face;
    const away = o ? (r.x < o.x ? -1 : 1) : r.hx < 0 ? 1 : -1;
    this.crashVx = away * 22 + r.hx * 20;
    this.crashVy = -48;
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
  }

  /** The run is over for good: the tumble after a crash is done. */
  get finished(): boolean {
    return this.crashed && this.crashT >= CRASH_TIME;
  }
}
