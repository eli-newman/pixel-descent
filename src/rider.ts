import { EDGE, MAX_SPEED, START_X, START_Y, W } from './config';

export type Face = 1 | -1;

/** Largest sideways share of the heading (0 is straight downhill, 1 is straight sideways). */
export const MAX_HX = 0.86;
const STIFFNESS = 85;
const DAMPING = 13;
/** Recovery acceleration (px/s^2) when slower than cruising speed. */
const ACCEL = 70;

/** Heading share below which the rider counts as "not turning" and tucks for speed. */
export const TUCK_HX = 0.32;
/** Extra acceleration (px/s^2) of a straight tuck, before air drag eats into it near top speed. */
export const TUCK_ACCEL = 62;
/** Fraction of cruising speed lost when carving as hard as possible. */
const CARVE_LOSS = 0.12;
/** Base rate (1/s) at which speed above the carve target bleeds off, plus a share per unit of hx. */
const SCRUB_BASE = 0.7;
const SCRUB_HX = 7;
/** Slowest the rider ever goes while moving. */
export const MIN_SPEED = 28;

/** Seconds a trick spin takes. A trick can only start when at least this much air time is left. */
export const TRICK_TIME = 0.42;
/** Landing heading (hx) up to which a landing is clean, and beyond which the rider bails. */
export const CLEAN_HX = 0.35;
export const BAIL_HX = 0.7;

export interface Surface {
  /** Looser steering, and carving scrubs less speed. */
  ice: boolean;
  /** Heavy snow: no tuck, speed bleeds off towards a crawl. */
  drift: boolean;
}

export interface RiderState {
  /** Board tail position in world space. */
  x: number;
  y: number;
  /** Sideways component of the unit heading vector, eased towards the steering target. */
  hx: number;
  /** Rate of change of hx, which gives the carve its weight. */
  hv: number;
  /** Speed along the heading in px/s. */
  speed: number;
  face: Face;
  steep: boolean;
  /** True while in the air after a kicker. */
  air: boolean;
  /** Seconds into the jump, and the total length of it. */
  airT: number;
  airDur: number;
  /** Peak height of the jump in px (cosmetic: collisions are simply off while airborne). */
  airH: number;
  /** Seconds into the current trick spin (0 when not spinning), and tricks finished this jump. */
  trickT: number;
  tricks: number;
  /** Set by stepRider for the caller: a trick finished, or the jump ended, during this step. */
  trickDone: boolean;
  landed: boolean;
}

export function createRider(): RiderState {
  return {
    x: START_X,
    y: START_Y,
    hx: 0,
    hv: 0,
    speed: 0,
    face: -1,
    steep: true,
    air: false,
    airT: 0,
    airDur: 0,
    airH: 0,
    trickT: 0,
    tricks: 0,
    trickDone: false,
    landed: false,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Cruising speed in px/s at a distance in metres. Ramps up gradually towards a cap. This is the base difficulty ramp. */
export function cruiseSpeed(distM: number): number {
  return 85 + 150 * (1 - Math.exp(-distM / 1000));
}

/** Highest speed a straight tuck can reach at a distance in metres. Always above cruising speed. */
export function topSpeed(distM: number): number {
  return Math.min(MAX_SPEED, cruiseSpeed(distM) * 1.18 + 100);
}

/** 0 at cruising speed, 1 at top speed: how much of the tuck bonus the rider is using. */
export function tuckFraction(speed: number, distM: number): number {
  const c = cruiseSpeed(distM);
  const t = topSpeed(distM);
  return clamp01((speed - c) / Math.max(1, t - c));
}

/** Score multiplier for distance, near misses and combos: x1 at cruising speed up to x2.5 at top speed. */
export function speedMultiplier(frac: number): number {
  return 1 + 1.5 * clamp01(frac);
}

/** Downhill share of the unit heading vector. */
export function headingY(hx: number): number {
  return Math.sqrt(Math.max(0, 1 - hx * hx));
}

export function headingAngle(hx: number): number {
  return (Math.atan2(headingY(hx), Math.abs(hx)) * 180) / Math.PI;
}

/** How long a jump lasts at a given speed (seconds). */
export function airTime(speed: number): number {
  return 0.46 + 0.0009 * speed;
}

/** Furthest the rider can travel downhill in one jump at the given speed (px). */
export function maxFlightPx(speed: number): number {
  return airTime(speed) * speed;
}

export function launch(r: RiderState): void {
  r.air = true;
  r.airT = 0;
  r.airDur = airTime(r.speed);
  r.airH = 12 + 14 * clamp01(r.speed / MAX_SPEED);
  r.trickT = 0;
  r.tricks = 0;
}

/** Height above the snow in px (a parabola over the jump). */
export function riderZ(r: RiderState): number {
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}

/** Start a trick spin if airborne, not already spinning and there is time to finish it. */
export function startTrick(r: RiderState): boolean {
  if (!r.air || r.trickT > 0 || r.airDur - r.airT < TRICK_TIME + 0.02) return false;
  r.trickT = 1e-6;
  return true;
}

/** Spin progress 0..1 of the current trick (0 when not spinning). */
export function trickProgress(r: RiderState): number {
  return r.trickT > 0 ? Math.min(1, r.trickT / TRICK_TIME) : 0;
}

export interface StepEnv {
  cruise: number;
  top: number;
  surface: Surface;
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
  r.trickDone = false;
  r.landed = false;
  const ice = env.surface.ice && !r.air;
  const stiff = STIFFNESS * (r.air ? 0.5 : ice ? 0.38 : 1);
  const damp = DAMPING * (ice ? 0.5 : 1);
  const lock = 1;
  const spinning = r.trickT > 0;
  const goal = spinning ? 0 : Math.max(-1, Math.min(1, steer)) * MAX_HX * lock;
  r.hv += (goal - r.hx) * stiff * dt;
  r.hv *= Math.exp(-damp * dt);
  r.hx = Math.max(-0.95, Math.min(0.95, r.hx + r.hv * dt));

  if (!r.air) stepSpeed(r, dt, env);

  r.x += r.hx * r.speed * dt;
  r.y += headingY(r.hx) * r.speed * dt;

  if (r.air) {
    r.airT += dt;
    if (spinning) {
      r.trickT += dt;
      if (r.trickT >= TRICK_TIME) {
        r.trickT = 0;
        r.tricks += 1;
        r.trickDone = true;
      }
    }
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

/** Ground speed update: tuck acceleration, carve scrub, drifts and ice. */
function stepSpeed(r: RiderState, dt: number, env: StepEnv): void {
  const c = Math.abs(r.hx);
  const { cruise, top, surface } = env;
  if (surface.drift) {
    // Heavy snow drags the rider down to a crawl, whatever the heading.
    const crawl = Math.max(MIN_SPEED, cruise * 0.42);
    if (r.speed > crawl) r.speed += (crawl - r.speed) * Math.min(1, 2.4 * dt);
    else r.speed = Math.min(crawl, r.speed + ACCEL * 0.5 * dt);
    return;
  }
  const straight = clamp01(1 - c / TUCK_HX);
  const carveSpeed = cruise * (1 - CARVE_LOSS * clamp01(c / MAX_HX));
  const target = carveSpeed + (top - carveSpeed) * straight;
  if (r.speed < target) {
    let a = ACCEL;
    if (r.speed >= cruise) {
      const f = clamp01((r.speed - cruise) / Math.max(1, top - cruise));
      a = TUCK_ACCEL * straight * (1 - 0.75 * f * f);
    }
    r.speed = Math.min(target, r.speed + a * dt);
  } else if (r.speed > target) {
    const rate = (SCRUB_BASE + SCRUB_HX * c) * (surface.ice ? 0.35 : 1);
    r.speed += (target - r.speed) * Math.min(1, rate * dt);
  }
  if (r.speed > MAX_SPEED) r.speed = MAX_SPEED;
}

/** Everything the renderer needs to draw the rider at a screen position. */
export interface RiderPose {
  /** Board tail (the track head) in screen pixels. */
  x: number;
  y: number;
  /** Unit vector along the board, pointing downhill. */
  nx: number;
  ny: number;
  /** +1 heading right (heel side, back to camera), -1 heading left (toe side, chest to camera). */
  face: 1 | -1;
  /** 0 on the flats .. 1 fully upright, derived from how sideways the rider points. */
  up: number;
  /** Heading angle in degrees, 90 is straight downhill. */
  ang: number;
  /** Straight-downhill boards are drawn as an outline. */
  steep: boolean;
  /** 0..1: how deep the rider is in the straight-line speed tuck. */
  tuck: number;
}

export function poseOf(r: RiderState, screenX: number, screenY: number, tuck: number): RiderPose {
  const prog = trickProgress(r);
  if (prog > 0) {
    // A trick whirls the board round the rider in the screen plane (a flat 360).
    const phi = prog * Math.PI * 2 * r.face;
    const nx = Math.sin(phi);
    const ny = Math.max(0.28, 0.5 + 0.5 * Math.cos(phi));
    const len = Math.hypot(nx, ny);
    const ang = (Math.atan2(ny, Math.abs(nx)) * 180) / Math.PI;
    return {
      x: screenX,
      y: screenY,
      nx: nx / len,
      ny: ny / len,
      face: nx >= 0 ? 1 : -1,
      up: 0.8,
      ang,
      steep: false,
      tuck: 0,
    };
  }
  const ang = headingAngle(r.hx);
  const a = (ang * Math.PI) / 180;
  return {
    x: screenX,
    y: screenY,
    nx: r.face * Math.cos(a),
    ny: Math.sin(a),
    face: r.face,
    up: Math.min(1, Math.abs(r.hx) * 2.2),
    ang,
    steep: r.steep,
    tuck,
  };
}
