import { MAX_SPEED } from '../core/config';
import { detExp } from '../core/detMath';
import type { RiderState, Surface } from './riderState';

/**
 * The speed model. Everything but `stepSpeed` also sizes the course (the spawner imports it), so it
 * must stay exact arithmetic: see the cross-browser rule in this folder's CLAUDE.md.
 */

/** Largest sideways share of the heading (0 is straight downhill, 1 is straight sideways). */
export const MAX_HX = 0.86;
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

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Cruising speed in px/s at a distance in metres. Ramps up gradually towards a cap. This is the base difficulty ramp. */
export function cruiseSpeed(distM: number): number {
  // detExp: the course generator sizes its path and landing zones from this.
  return 85 + 150 * (1 - detExp(-distM / 1000));
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

/** What the ground speed depends on besides the rider. */
export interface SpeedEnv {
  cruise: number;
  top: number;
  surface: Surface;
}

/** Ground speed update: tuck acceleration, carve scrub, drifts and ice. */
export function stepSpeed(r: RiderState, dt: number, env: SpeedEnv): void {
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
