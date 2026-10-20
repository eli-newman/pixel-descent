import { PX_PER_M, START_Y } from './config';

export const POINTS = { star: 10, laneStar: 30, nearMiss: 25, gate: 100, trick: 50 } as const;
/** Near misses landing within this many seconds of each other build a combo. */
export const COMBO_WINDOW = 2.5;
export const MAX_COMBO = 5;

export interface ScoreState {
  stars: number;
  /** Stars taken from a risk lane. */
  laneStars: number;
  starPoints: number;
  gates: number;
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
    gates: 0,
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

export function addGate(s: ScoreState): number {
  s.gates += 1;
  return POINTS.gate;
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

/** A finished trick scores more with every extra trick in the same jump. Returns points. */
export function addTrick(s: ScoreState, nthInJump: number, mult: number): number {
  s.tricks += 1;
  const pts = Math.round(POINTS.trick * nthInJump * mult);
  s.trickPoints += pts;
  return pts;
}

/** A sloppy landing or a bail breaks the combo. */
export function breakCombo(s: ScoreState): void {
  s.combo = 0;
}

export function totalScore(s: ScoreState): number {
  return (
    Math.floor(s.distPoints) +
    s.starPoints +
    s.gates * POINTS.gate +
    s.nearMissPoints +
    s.trickPoints
  );
}
