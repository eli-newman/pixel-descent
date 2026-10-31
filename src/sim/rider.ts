import { EDGE, MAX_SPEED, W } from '../core/config';
import type { RiderState } from './riderState';
import { airTime, clamp01, CLIFF_AIR, MAX_HX, MIN_SPEED, stepSpeed, type SpeedEnv } from './speed';
import { holdSpin, resetFlip, resetManualSpin, SPIN_STEER, stepPitch, stepSpin } from './tricks';

const STIFFNESS = 85;
const DAMPING = 13;
/** Heading share of a braking rider (board nearly flat across the slope), the speed he slows to, and how fast. */
const BRAKE_HX = 0.93;
const BRAKE_CRAWL = 0.3;
const BRAKE_SCRUB = 3.4;

/** Downhill share of the unit heading vector. */
export function headingY(hx: number): number {
  return Math.sqrt(Math.max(0, 1 - hx * hx));
}

export function headingAngle(hx: number): number {
  return (Math.atan2(headingY(hx), Math.abs(hx)) * 180) / Math.PI;
}

export function launch(r: RiderState, cliff = false): void {
  r.air = true;
  r.airT = 0;
  r.airDur = airTime(r.speed) * (cliff ? CLIFF_AIR : 1);
  r.airH = (12 + 14 * clamp01(r.speed / MAX_SPEED)) * (cliff ? 2 : 1);
  r.spin = 0;
  r.spinDir = 0;
  r.spinGoal = 0;
  r.spinDone = 0;
  resetManualSpin(r);
  resetFlip(r);
}

/** Height above the snow in px (a parabola over the jump). */
export function riderZ(r: RiderState): number {
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}

export interface StepEnv extends SpeedEnv {
  /** Flip key held: 1 backflip (up), -1 frontflip (down), 0 none. */
  flip?: -1 | 0 | 1;
  /** Manual spin: the arrows turn the rider continuously and he holds whatever angle he is left at. */
  manual?: boolean;
  /** Left and right held together. */
  brake?: boolean;
}

/**
 * Advance the rider by dt. The steering input in [-1, 1] sets a target heading; a damped spring
 * moves the real heading towards it, so the board eases from toe side to heel side.
 *
 * Speed model: going straight downhill (heading share below TUCK_HX) accelerates the rider towards
 * `top`, well past cruising speed. Carving across the slope pulls the target speed back down to
 * `cruise * (1 - CARVE_LOSS)` and bleeds speed off faster the more sideways the heading is.
 */
export function stepRider(r: RiderState, steer: number, dt: number, env: StepEnv): void {
  r.spinDone = 0;
  r.landed = false;
  const ice = env.surface.ice && !r.air;
  const stiff = STIFFNESS * (r.air ? 0.5 : ice ? 0.38 : 1);
  const damp = DAMPING * (ice ? 0.5 : 1);
  // The arrows never steer in the air: the flight path is fixed by the launch. They only turn the
  // rider, which (assisted) keeps a spin going a half turn at a time or (manual) turns him freely.
  const manual = env.manual === true;
  r.flipDone = 0;
  if (r.air && !manual && Math.abs(steer) >= SPIN_STEER) holdSpin(r, steer > 0 ? 1 : -1);
  // Braking: the board swings across the slope while the rider keeps sliding downhill.
  const wantBrake = env.brake === true && !r.air;
  r.brake += ((wantBrake ? 1 : 0) - r.brake) * Math.min(1, (wantBrake ? 10 : 7) * dt);
  if (r.brake < 0.001) r.brake = 0;
  const steerGoal = Math.max(-1, Math.min(1, steer)) * MAX_HX;
  const goal = r.air ? 0 : steerGoal + (r.face * BRAKE_HX - steerGoal) * r.brake;
  r.hv += (goal - r.hx) * stiff * dt;
  r.hv *= Math.exp(-damp * dt);
  r.hx = Math.max(-0.95, Math.min(0.95, r.hx + r.hv * dt));

  if (!r.air) stepSpeed(r, dt, env);
  if (r.brake > 0.02 && !r.air) {
    // Plowing through the snow bleeds speed hard, down to a crawl.
    const crawl = Math.max(MIN_SPEED, env.cruise * BRAKE_CRAWL);
    if (r.speed > crawl) r.speed += (crawl - r.speed) * Math.min(1, BRAKE_SCRUB * r.brake * dt);
  }

  // The board points across the slope but the rider slides on downhill, so movement ignores most of the brake heading.
  const mh = r.hx * (1 - 0.92 * r.brake);
  r.x += mh * r.speed * dt;
  r.y += headingY(mh) * r.speed * dt;

  if (r.air) {
    r.airT += dt;
    stepSpin(r, steer, manual, dt);
    stepPitch(r, env.flip ?? 0, manual, dt);
    if (r.airT >= r.airDur) r.landed = true;
  }

  // The slope has soft walls: pinned against one, the rider is turned away and loses speed.
  if (r.x < EDGE || r.x > W - EDGE) {
    r.x = r.x < EDGE ? EDGE : W - EDGE;
    r.hx *= 0.5;
    r.hv = 0;
    r.speed *= Math.exp(-2 * dt);
  }

  // Same hysteresis as the source art: no flicker between solid and outlined board or stances.
  const ang = headingAngle(r.hx);
  if (ang > 74) r.steep = true;
  else if (ang < 66) r.steep = false;
  if (r.hx > 0.05) r.face = 1;
  else if (r.hx < -0.05) r.face = -1;
}
