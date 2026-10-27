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
/** Heading share of a braking rider (board nearly flat across the slope), the speed he slows to, and how fast. */
const BRAKE_HX = 0.93;
const BRAKE_CRAWL = 0.3;
const BRAKE_SCRUB = 3.4;

/** Spin speed in degrees per second. Air time decides how many half turns fit: see `spinCap`. */
export const SPIN_RATE = 720;
/** Seconds before touchdown by which every spin has to be finished, so the rider can set up the landing. */
export const SPIN_SETTLE = 0.06;
/** The most a single jump can spin, in degrees (two full turns). */
export const MAX_SPIN = 720;
/** Manual spin: top turning speed (deg/s), how fast it eases in and out (deg/s^2), and the speed of a TRICK snap. */
export const MANUAL_RATE = 600;
export const MANUAL_EASE = 10000;
export const MANUAL_SNAP_RATE = 1440;
/** Steering at or beyond this magnitude, while airborne, counts as "hold a direction" and spins that way. */
export const SPIN_STEER = 0.5;
/** How far (degrees) from a half turn a landing can be and still count as clean, sloppy, or a bail. */
export const SPIN_CLEAN = 40;
export const SPIN_BAIL = 65;
/**
 * Flips (rotation about the horizontal axis, end over end). Positive pitch is a backflip. Assisted
 * flips turn at FLIP_RATE deg/s and stop on a full turn that fits the air time (less FLIP_SETTLE).
 */
export const FLIP_RATE = 600;
export const FLIP_SETTLE = 0.06;
/** The most a single jump can flip in assisted mode, in degrees (two full turns). */
export const MAX_FLIP = 720;
/** Manual flip: top pitching speed (deg/s). The ease reuses MANUAL_EASE. */
export const MANUAL_FLIP_RATE = 540;
/** How far (degrees) from a full turn a landing can be and still count as clean, sloppy, or a bail. */
export const FLIP_CLEAN = 40;
export const FLIP_BAIL = 70;
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
  /**
   * Degrees turned so far this jump (never negative), the direction of the spin (0 until one starts,
   * then 1 or -1), and the multiple of 180 it is turning towards.
   */
  spin: number;
  spinDir: 0 | 1 | -1;
  spinGoal: number;
  /** Set by stepRider for the caller: the spin came to rest on a half turn (this many degrees) during this step. */
  spinDone: number;
  /**
   * Manual spin only: the signed angle in degrees (`spin` is its size and `spinDir` its sign), the
   * current turning speed in deg/s, the part of a TRICK snap still to turn, and the half turn
   * already announced to the caller.
   */
  spinAng: number;
  spinW: number;
  snap: number;
  spinSaid: number;
  /**
   * Flip state. `pitch` is the signed angle in degrees (positive is a backflip). Assisted: `flipDir`
   * is the direction chosen for the jump (0 until one starts) and `flipGoal` the size of the turn
   * being made (a multiple of 360). Manual: `pitchW` is the current pitching speed in deg/s and
   * `flipSaid` the full turn already announced. `flipDone` is set by stepRider for the caller when
   * a flip came to rest on a full turn during this step (signed degrees).
   */
  pitch: number;
  flipDir: 0 | 1 | -1;
  flipGoal: number;
  pitchW: number;
  flipSaid: number;
  flipDone: number;
  /** Set by stepRider for the caller: the jump ended during this step. */
  landed: boolean;
  /** 0..1: how far the board has swung sideways into a plowing stop. */
  brake: number;
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
    spin: 0,
    spinDir: 0,
    spinGoal: 0,
    spinDone: 0,
    spinAng: 0,
    spinW: 0,
    snap: 0,
    spinSaid: 0,
    pitch: 0,
    flipDir: 0,
    flipGoal: 0,
    pitchW: 0,
    flipSaid: 0,
    flipDone: 0,
    landed: false,
    brake: 0,
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

/** A cliff drop hangs in the air this many times longer than a kicker hop, and goes higher. */
export const CLIFF_AIR = 1.9;

/** Furthest the rider can travel downhill in one jump at the given speed (px). */
export function maxFlightPx(speed: number, cliff = false): number {
  return airTime(speed) * speed * (cliff ? CLIFF_AIR : 1);
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

/** Clear the flip state (a new jump, or a landing). */
export function resetFlip(r: RiderState): void {
  r.pitch = 0;
  r.flipDir = 0;
  r.flipGoal = 0;
  r.pitchW = 0;
  r.flipSaid = 0;
  r.flipDone = 0;
}

/** Clear the manual spin state (a new jump, or a landing). */
export function resetManualSpin(r: RiderState): void {
  r.spinAng = 0;
  r.spinW = 0;
  r.snap = 0;
  r.spinSaid = 0;
}

/**
 * Manual mode TRICK: a quick extra half turn (snapped at 1440 deg/s) in the direction given. Presses
 * stack. Returns false when not airborne.
 */
export function startSnap(r: RiderState, dir: 1 | -1): boolean {
  if (!r.air) return false;
  r.snap += 180 * dir;
  return true;
}

/** Height above the snow in px (a parabola over the jump). */
export function riderZ(r: RiderState): number {
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}

/**
 * The most the rider can still spin this jump, in degrees (a multiple of 180). It is what the turned
 * angle plus the air time left (minus the settle time) can reach, so a spin can always be finished.
 */
export function spinCap(r: RiderState): number {
  if (!r.air) return 0;
  const left = Math.max(0, r.airDur - r.airT - SPIN_SETTLE);
  const reach = r.spin + left * SPIN_RATE;
  return Math.min(MAX_SPIN, Math.floor(reach / 180 + 1e-6) * 180);
}

/**
 * Ask for more spin in a direction (1 or -1): a full turn if the air time allows it, else a half turn.
 * The direction of the first request sticks for the jump. Returns false if nothing was added.
 */
export function startTrick(r: RiderState, dir: 1 | -1): boolean {
  if (!r.air) return false;
  if (r.spinDir === 0) r.spinDir = dir;
  const cap = spinCap(r);
  const rest = r.spinGoal;
  const goal = rest + 360 <= cap ? rest + 360 : rest + 180 <= cap ? rest + 180 : rest;
  if (goal === r.spinGoal) {
    if (r.spinGoal === 0) r.spinDir = 0;
    return false;
  }
  r.spinGoal = goal;
  return true;
}

/**
 * The most the rider can still flip this jump, in degrees (a multiple of 360): what the turned
 * angle plus the air time left (minus the settle time) can reach, so a flip can always be finished.
 */
export function flipCap(r: RiderState): number {
  if (!r.air) return 0;
  const left = Math.max(0, r.airDur - r.airT - FLIP_SETTLE);
  const reach = Math.abs(r.pitch) + left * FLIP_RATE;
  return Math.min(MAX_FLIP, Math.floor(reach / 360 + 1e-6) * 360);
}

/**
 * Assisted mode: queue one more full flip in a direction (1 backflip, -1 frontflip) if the air time
 * allows it. The direction of the first flip sticks for the jump. Returns false if nothing was added.
 */
export function startFlip(r: RiderState, dir: 1 | -1): boolean {
  if (!r.air) return false;
  if (r.flipDir !== 0 && r.flipDir !== dir) return false;
  const goal = r.flipGoal + 360;
  if (goal > flipCap(r)) return false;
  r.flipDir = dir;
  r.flipGoal = goal;
  return true;
}

/** Turns made, as a whole signed number (positive backflips), and how far off a full turn the pitch is (0 to 180). */
export function flipLanding(r: RiderState): { turns: number; off: number } {
  const turns = Math.round(r.pitch / 360);
  return { turns: turns === 0 ? 0 : turns, off: Math.abs(r.pitch - turns * 360) };
}

/** The spin as a signed angle in degrees (positive turns clockwise on screen). */
export function spinAngle(r: RiderState): number {
  return r.spin * r.spinDir;
}

/** Degrees of the half turn the rider is nearest to, and how far off it he is (0 to 90). */
export function spinLanding(r: RiderState): { deg: number; off: number } {
  const halves = Math.round(r.spin / 180);
  return { deg: halves * 180, off: Math.abs(r.spin - halves * 180) };
}

/** Hold a direction in the air: keep the spin going a half turn at a time, as far as the air time allows. */
function holdSpin(r: RiderState, dir: 1 | -1): void {
  if (r.spinDir === 0) r.spinDir = dir;
  if (r.spinDir !== dir) return;
  if (r.spin >= r.spinGoal - 1e-6 && r.spinGoal + 180 <= spinCap(r)) r.spinGoal += 180;
}

export interface StepEnv {
  /** Flip key held: 1 backflip (up), -1 frontflip (down), 0 none. */
  flip?: -1 | 0 | 1;
  /** Manual spin: the arrows turn the rider continuously and he holds whatever angle he is left at. */
  manual?: boolean;
  /** Left and right held together. */
  brake?: boolean;
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
  r.spinDone = 0;
  r.landed = false;
  const ice = env.surface.ice && !r.air;
  const stiff = STIFFNESS * (r.air ? 0.5 : ice ? 0.38 : 1);
  const damp = DAMPING * (ice ? 0.5 : 1);
  const lock = 1;
  // The arrows never steer in the air: the flight path is fixed by the launch. They only turn the
  // rider, which (assisted) keeps a spin going a half turn at a time or (manual) turns him freely.
  const manual = env.manual === true;
  r.flipDone = 0;
  if (r.air && !manual && Math.abs(steer) >= SPIN_STEER) holdSpin(r, steer > 0 ? 1 : -1);
  // Braking: the board swings across the slope while the rider keeps sliding downhill.
  const wantBrake = env.brake === true && !r.air;
  r.brake += ((wantBrake ? 1 : 0) - r.brake) * Math.min(1, (wantBrake ? 10 : 7) * dt);
  if (r.brake < 0.001) r.brake = 0;
  const steerGoal = Math.max(-1, Math.min(1, steer)) * MAX_HX * lock;
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
    if (manual) stepManualSpin(r, steer, dt);
    else if (r.spinGoal > 0 && r.spin < r.spinGoal) {
      r.spin = Math.min(r.spinGoal, r.spin + SPIN_RATE * dt);
      if (r.spin >= r.spinGoal - 1e-6) {
        r.spin = r.spinGoal;
        if (Math.abs(steer) >= SPIN_STEER) holdSpin(r, steer > 0 ? 1 : -1);
        if (r.spin >= r.spinGoal - 1e-6) r.spinDone = r.spinGoal;
      }
    }
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

/** Hold a flip key in the air (assisted): start the next full flip once the last one is done, if time allows. */
function holdFlip(r: RiderState, dir: 1 | -1): void {
  if (r.flipDir !== 0 && r.flipDir !== dir) return;
  if (Math.abs(r.pitch) >= r.flipGoal - 1e-6) startFlip(r, dir);
}

/** Pitch (flip) for one step. Assisted turns towards the goal; manual follows the held key and holds the angle. */
function stepPitch(r: RiderState, flip: -1 | 0 | 1, manual: boolean, dt: number): void {
  if (manual) {
    const want = flip * MANUAL_FLIP_RATE;
    const dw = MANUAL_EASE * dt;
    r.pitchW += Math.max(-dw, Math.min(dw, want - r.pitchW));
    r.pitch += r.pitchW * dt;
    if (want === 0 && r.pitchW === 0) {
      // At rest near a full turn: announce it once ("BACKFLIP!").
      const { turns, off } = flipLanding(r);
      if (turns !== 0 && off <= FLIP_CLEAN && turns !== r.flipSaid) {
        r.flipSaid = turns;
        r.flipDone = turns * 360;
      }
    } else {
      r.flipSaid = 0;
    }
    return;
  }
  if (flip !== 0) holdFlip(r, flip);
  if (r.flipGoal > 0 && Math.abs(r.pitch) < r.flipGoal) {
    const dir = r.flipDir === 0 ? 1 : r.flipDir;
    const size = Math.min(r.flipGoal, Math.abs(r.pitch) + FLIP_RATE * dt);
    r.pitch = size * dir;
    if (size >= r.flipGoal - 1e-6) {
      r.pitch = r.flipGoal * dir;
      if (flip !== 0) holdFlip(r, flip);
      if (Math.abs(r.pitch) >= r.flipGoal - 1e-6) r.flipDone = r.flipGoal * dir;
    }
  }
}

/** Manual spin for one step: ease the turning speed towards the held key, apply any snap, report rests. */
function stepManualSpin(r: RiderState, steer: number, dt: number): void {
  const want = steer >= SPIN_STEER ? MANUAL_RATE : steer <= -SPIN_STEER ? -MANUAL_RATE : 0;
  const dw = MANUAL_EASE * dt;
  r.spinW += Math.max(-dw, Math.min(dw, want - r.spinW));
  let turn = r.spinW * dt;
  if (r.snap !== 0) {
    const d = Math.sign(r.snap) * Math.min(Math.abs(r.snap), MANUAL_SNAP_RATE * dt);
    r.snap -= d;
    turn += d;
  }
  r.spinAng += turn;
  r.spin = Math.abs(r.spinAng);
  r.spinDir = r.spinAng > 0 ? 1 : r.spinAng < 0 ? -1 : 0;
  if (want === 0 && r.spinW === 0 && r.snap === 0) {
    // At rest near a half turn: announce it once ("360!").
    const { deg, off } = spinLanding(r);
    if (deg > 0 && off <= SPIN_CLEAN && deg !== r.spinSaid) {
      r.spinSaid = deg;
      r.spinDone = deg;
    }
  } else {
    r.spinSaid = 0;
  }
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

/** Half the drawn board length in px (the spin pivots here). Kept in step with BOARD_LEN in the rider sprite. */
const SPIN_HALF_BOARD = Math.round(23 * 0.85) / 2;

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
  /** Flip angle in degrees (positive is a backflip, 0 or a multiple of 360 is upright). */
  pitch: number;
}

export function poseOf(r: RiderState, screenX: number, screenY: number, tuck: number): RiderPose {
  const ang0 = headingAngle(r.hx);
  const a = (ang0 * Math.PI) / 180;
  if (r.air && r.spin > 0) {
    // A spin turns the rider about the middle of the board: the board swings round through all
    // four directions, so he shows his chest, then his side, then his back (and the board points
    // up the slope for a moment) as it goes.
    // Screen y points down, so a positive angle would swing the nose to the left; negate it so holding right swings it right.
    const phi = (-spinAngle(r) * Math.PI) / 180;
    const bx = r.face * Math.cos(a);
    const by = Math.sin(a);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const nx = bx * c - by * sn;
    const ny = bx * sn + by * c;
    // The tail is placed so the middle of the board stays where the unspun rider's would be.
    const half = SPIN_HALF_BOARD;
    const mx = screenX + bx * half;
    const my = screenY + by * half;
    const pang = (Math.atan2(Math.abs(ny), Math.abs(nx)) * 180) / Math.PI;
    return {
      x: mx - nx * half,
      y: my - ny * half,
      nx,
      ny,
      face: nx >= 0 ? 1 : -1,
      up: Math.min(1, Math.abs(nx) * 2.2),
      ang: pang,
      steep: pang > 70,
      tuck: 0,
      pitch: r.pitch,
    };
  }
  return {
    x: screenX,
    y: screenY,
    nx: r.face * Math.cos(a),
    ny: Math.sin(a),
    face: r.face,
    up: Math.min(1, Math.abs(r.hx) * 2.2),
    ang: ang0,
    steep: r.steep,
    tuck,
    pitch: r.air ? r.pitch : 0,
  };
}
