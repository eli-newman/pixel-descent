import type { RiderState } from './riderState';

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
export function holdSpin(r: RiderState, dir: 1 | -1): void {
  if (r.spinDir === 0) r.spinDir = dir;
  if (r.spinDir !== dir) return;
  if (r.spin >= r.spinGoal - 1e-6 && r.spinGoal + 180 <= spinCap(r)) r.spinGoal += 180;
}

/** Spin for one step. Assisted turns towards the goal; manual follows the held direction. */
export function stepSpin(r: RiderState, steer: number, manual: boolean, dt: number): void {
  if (manual) stepManualSpin(r, steer, dt);
  else if (r.spinGoal > 0 && r.spin < r.spinGoal) {
    r.spin = Math.min(r.spinGoal, r.spin + SPIN_RATE * dt);
    if (r.spin >= r.spinGoal - 1e-6) {
      r.spin = r.spinGoal;
      if (Math.abs(steer) >= SPIN_STEER) holdSpin(r, steer > 0 ? 1 : -1);
      if (r.spin >= r.spinGoal - 1e-6) r.spinDone = r.spinGoal;
    }
  }
}

/** Hold a flip key in the air (assisted): start the next full flip once the last one is done, if time allows. */
function holdFlip(r: RiderState, dir: 1 | -1): void {
  if (r.flipDir !== 0 && r.flipDir !== dir) return;
  if (Math.abs(r.pitch) >= r.flipGoal - 1e-6) startFlip(r, dir);
}

/** Pitch (flip) for one step. Assisted turns towards the goal; manual follows the held key and holds the angle. */
export function stepPitch(r: RiderState, flip: -1 | 0 | 1, manual: boolean, dt: number): void {
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
