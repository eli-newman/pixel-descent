import { PX_PER_M, START_Y } from '../core/config';

export const POINTS = {
  star: 10,
  laneStar: 30,
  nearMiss: 25,
  spin: 30,
  drop: 75,
} as const;
/** Near misses landing within this many seconds of each other build a combo. */
export const COMBO_WINDOW = 2.5;
export const MAX_COMBO = 5;

export interface ScoreState {
  stars: number;
  /** Stars taken from a risk lane. */
  laneStars: number;
  starPoints: number;
  nearMisses: number;
  /** Points from near misses (combo and speed multiplied). */
  nearMissPoints: number;
  combo: number;
  maxCombo: number;
  lastNearMissAt: number;
  /** Clean landings, finished tricks and the points they gave. */
  landings: number;
  tricks: number;
  trickPoints: number;
  /** Distance points: one per metre, scaled by the speed multiplier. Fractional until displayed. */
  distPoints: number;
}

export function createScore(): ScoreState {
  return {
    stars: 0,
    laneStars: 0,
    starPoints: 0,
    nearMisses: 0,
    nearMissPoints: 0,
    combo: 0,
    maxCombo: 0,
    lastNearMissAt: -Infinity,
    landings: 0,
    tricks: 0,
    trickPoints: 0,
    distPoints: 0,
  };
}

/** Whole metres travelled down the slope for a rider at world y. */
export function distanceMeters(y: number): number {
  return Math.max(0, Math.floor((y - START_Y) / PX_PER_M));
}

/** Add distance points for a move of dy world pixels at a speed multiplier. */
export function addDistance(s: ScoreState, dy: number, mult: number): void {
  if (dy > 0) s.distPoints += (dy / PX_PER_M) * mult;
}

export function addStar(s: ScoreState, lane = false): number {
  const pts = lane ? POINTS.laneStar : POINTS.star;
  s.stars += 1;
  if (lane) s.laneStars += 1;
  s.starPoints += pts;
  return pts;
}

/** Register a near miss at run time `now` (seconds). `mult` is the speed multiplier. Returns the points awarded. */
export function addNearMiss(s: ScoreState, now: number, mult = 1): number {
  s.combo = now - s.lastNearMissAt <= COMBO_WINDOW ? Math.min(MAX_COMBO, s.combo + 1) : 1;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  s.lastNearMissAt = now;
  s.nearMisses += 1;
  const pts = Math.round(POINTS.nearMiss * s.combo * mult);
  s.nearMissPoints += pts;
  return pts;
}

/** Remaining share (1 to 0) of the combo window; 0 when there is no live combo. */
export function comboLeft(s: ScoreState, now: number): number {
  if (s.combo === 0) return 0;
  return Math.max(0, 1 - (now - s.lastNearMissAt) / COMBO_WINDOW);
}

/**
 * A spin landed clean pays for its degrees (180, 360, 540 or 720), and every extra half turn is
 * worth more than the last: 30, 70, 120, 180 points at a speed multiplier of 1. Returns points.
 */
export function spinPoints(deg: number): number {
  const n = Math.max(0, Math.round(deg / 180));
  return POINTS.spin * n + 10 * ((n * (n - 1)) / 2);
}

export function addSpin(s: ScoreState, deg: number, mult: number): number {
  s.tricks += 1;
  const pts = Math.round(spinPoints(deg) * mult);
  s.trickPoints += pts;
  return pts;
}

/**
 * A flip landed clean pays by the number of full flips: 80, 220, 400 points, then 200 more for each
 * one after that (at a speed multiplier of 1).
 */
export function flipPoints(flips: number): number {
  const n = Math.max(0, Math.round(flips));
  const table = [0, 80, 220, 400];
  return n < table.length ? (table[n] ?? 0) : 400 + 200 * (n - 3);
}

/** Landing a flip together with a spin pays half as much again on top of the two. */
export const COMBO_BONUS = 0.5;

/**
 * Score `flips` landed flips (each counts as a trick) and, if a spin of `spinDeg` degrees landed in
 * the same jump, the combo bonus on top. Returns the points for the flips and the bonus (the spin
 * itself is paid by `addSpin`).
 */
export function addFlip(s: ScoreState, flips: number, spinDeg: number, mult: number): number {
  s.tricks += flips;
  let pts = Math.round(flipPoints(flips) * mult);
  if (spinDeg > 0)
    pts += Math.round((flipPoints(flips) + spinPoints(spinDeg)) * COMBO_BONUS * mult);
  s.trickPoints += pts;
  return pts;
}

/** Trick name for the toast: "BACKFLIP", "DOUBLE FRONTFLIP", "3X BACKFLIP". `turns` is signed. */
export function flipName(turns: number): string {
  const n = Math.abs(turns);
  const base = turns > 0 ? 'BACKFLIP' : 'FRONTFLIP';
  if (n <= 1) return base;
  return `${n === 2 ? 'DOUBLE' : n === 3 ? 'TRIPLE' : `${n}X`} ${base}`;
}

/** Bonus for sticking the landing after a cliff drop. Returns points. */
export function addDrop(s: ScoreState, mult: number): number {
  const pts = Math.round(POINTS.drop * mult);
  s.trickPoints += pts;
  return pts;
}

/** A sloppy landing or a bail breaks the combo. */
export function breakCombo(s: ScoreState): void {
  s.combo = 0;
}

export function totalScore(s: ScoreState): number {
  return Math.floor(s.distPoints) + s.starPoints + s.nearMissPoints + s.trickPoints;
}
