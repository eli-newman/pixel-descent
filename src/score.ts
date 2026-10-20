import { PX_PER_M, START_Y } from './config';

export const POINTS = { star: 10, nearMiss: 25, gate: 100 } as const;
/** Near misses landing within this many seconds of each other build a combo. */
export const COMBO_WINDOW = 2.5;
export const MAX_COMBO = 5;

export interface ScoreState {
  stars: number;
  gates: number;
  nearMisses: number;
  /** Points from near misses (combo multiplied). */
  nearMissPoints: number;
  combo: number;
  lastNearMissAt: number;
}

export function createScore(): ScoreState {
  return {
    stars: 0,
    gates: 0,
    nearMisses: 0,
    nearMissPoints: 0,
    combo: 0,
    lastNearMissAt: -Infinity,
  };
}

/** Whole metres travelled down the slope for a rider at world y. */
export function distanceMeters(y: number): number {
  return Math.max(0, Math.floor((y - START_Y) / PX_PER_M));
}

export function addStar(s: ScoreState): number {
  s.stars += 1;
  return POINTS.star;
}

export function addGate(s: ScoreState): number {
  s.gates += 1;
  return POINTS.gate;
}

/** Register a near miss at run time `now` (seconds). Returns the points awarded. */
export function addNearMiss(s: ScoreState, now: number): number {
  s.combo = now - s.lastNearMissAt <= COMBO_WINDOW ? Math.min(MAX_COMBO, s.combo + 1) : 1;
  s.lastNearMissAt = now;
  s.nearMisses += 1;
  const pts = POINTS.nearMiss * s.combo;
  s.nearMissPoints += pts;
  return pts;
}

export function totalScore(distM: number, s: ScoreState): number {
  return distM + s.stars * POINTS.star + s.gates * POINTS.gate + s.nearMissPoints;
}
