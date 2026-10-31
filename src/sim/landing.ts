import type { RiderState } from './riderState';
import { addDrop, addFlip, addSpin, breakCombo, type ScoreState } from './score';
import {
  BAIL_HX,
  CLEAN_HX,
  FLIP_BAIL,
  FLIP_CLEAN,
  flipLanding,
  resetFlip,
  resetManualSpin,
  SPIN_BAIL,
  SPIN_CLEAN,
  spinLanding,
} from './tricks';

export interface LandEvent {
  type: 'land';
  quality: 'clean' | 'sloppy';
  pts: number;
  /** Spins landed (0 or 1) and their degrees; `switch` is true on an odd number of half turns. */
  tricks: number;
  spin: number;
  switch: boolean;
  /** Net full flips landed, signed (positive backflips, 0 for none). */
  flips: number;
}

/**
 * Touch down. A clean landing pays for its spin and keeps the speed (a little less after an odd
 * number of half turns, which lands backwards), a sloppy one scrubs it, a bail returns null and the
 * caller crashes. Rotation counts too: a landing far from a half turn is a bail, a bit off is sloppy.
 */
export function touchDown(
  r: RiderState,
  score: ScoreState,
  wasCliff: boolean,
  mult: number,
  top: number,
): LandEvent | null {
  const a = Math.abs(r.hx);
  const { deg, off } = spinLanding(r);
  const { turns, off: flipOff } = flipLanding(r);
  r.air = false;
  r.spin = 0;
  r.spinDir = 0;
  r.spinGoal = 0;
  resetManualSpin(r);
  resetFlip(r);
  r.airT = 0;
  if (off > SPIN_BAIL || flipOff > FLIP_BAIL || a > BAIL_HX) {
    breakCombo(score);
    return null;
  }
  if (off > SPIN_CLEAN || flipOff > FLIP_CLEAN || a > CLEAN_HX) {
    r.speed = Math.max(40, r.speed * 0.6);
    breakCombo(score);
    return {
      type: 'land',
      quality: 'sloppy',
      pts: 0,
      tricks: 0,
      spin: 0,
      switch: false,
      flips: 0,
    };
  }
  const backwards = (deg / 180) % 2 === 1;
  const flips = Math.abs(turns);
  let pts = deg > 0 ? addSpin(score, deg, mult) : 0;
  if (flips > 0) pts += addFlip(score, flips, deg, mult);
  if (wasCliff) pts += addDrop(score, mult);
  score.landings += 1;
  r.speed = Math.min(top, r.speed + (deg > 0 ? (backwards ? 10 : 16) : flips > 0 ? 14 : 6));
  return {
    type: 'land',
    quality: 'clean',
    pts,
    tricks: (deg > 0 ? 1 : 0) + flips,
    spin: deg,
    switch: backwards,
    flips: turns,
  };
}
