import type { RiderState } from './riderState';
import {
  addDrop,
  addFlip,
  addGrab,
  addSpin,
  breakCombo,
  flipPoints,
  spinPoints,
  type ScoreState,
} from './score';
import {
  BAIL_HX,
  CLEAN_HX,
  FLIP_BAIL,
  FLIP_CLEAN,
  flipLanding,
  GRAB_BAIL_SPIN,
  GRAB_MIN,
  resetFlip,
  resetGrab,
  resetManualSpin,
  SPIN_BAIL,
  SPIN_CLEAN,
  spinLanding,
} from './tricks';

export interface LandEvent {
  type: 'land';
  quality: 'clean' | 'sloppy';
  pts: number;
  /** Spins landed (0 or 1) and their degrees; `switch` is true when the rider rides away switch. */
  tricks: number;
  spin: number;
  switch: boolean;
  /** Net full flips landed, signed (positive backflips, 0 for none). */
  flips: number;
  /** Seconds of grab landed (0 for none, or a hold too short to count). */
  grab: number;
  /** The rider was still grabbing at touchdown, which made the landing sloppy. */
  held: boolean;
}

/**
 * Touch down. A clean landing pays for its spin and keeps the speed (a little less after an odd
 * number of half turns, which lands backwards), a sloppy one scrubs it, a bail returns null and the
 * caller crashes. Rotation counts too: a landing far from a half turn is a bail, a bit off is sloppy.
 * Clean or sloppy, an odd number of half turns swaps the rider's stance (regular and switch).
 * A grab has to be let go before touchdown: still holding the board is sloppy, and a bail after a
 * flip or a spin of GRAB_BAIL_SPIN or more. A grab let go in time pays for how long it was held.
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
  const held = r.grab;
  const grabT = r.grabT;
  r.air = false;
  r.spin = 0;
  r.spinDir = 0;
  r.spinGoal = 0;
  resetManualSpin(r);
  resetFlip(r);
  resetGrab(r);
  r.airT = 0;
  const heldBail = held && (turns !== 0 || deg >= GRAB_BAIL_SPIN);
  if (off > SPIN_BAIL || flipOff > FLIP_BAIL || a > BAIL_HX || heldBail) {
    breakCombo(score);
    return null;
  }
  const backwards = (deg / 180) % 2 === 1;
  if (backwards) r.stance = r.stance === 1 ? -1 : 1;
  if (off > SPIN_CLEAN || flipOff > FLIP_CLEAN || a > CLEAN_HX || held) {
    r.speed = Math.max(40, r.speed * 0.6);
    breakCombo(score);
    return {
      type: 'land',
      quality: 'sloppy',
      pts: 0,
      tricks: 0,
      spin: 0,
      switch: r.stance === -1,
      flips: 0,
      grab: 0,
      held,
    };
  }
  const flips = Math.abs(turns);
  let pts = deg > 0 ? addSpin(score, deg, mult) : 0;
  if (flips > 0) pts += addFlip(score, flips, deg, mult);
  const grabPts = addGrab(score, grabT, GRAB_MIN, spinPoints(deg) + flipPoints(flips), mult);
  pts += grabPts;
  if (wasCliff) pts += addDrop(score, mult);
  score.landings += 1;
  r.speed = Math.min(top, r.speed + (deg > 0 ? (backwards ? 10 : 16) : flips > 0 ? 14 : 6));
  return {
    type: 'land',
    quality: 'clean',
    pts,
    tricks: (deg > 0 ? 1 : 0) + flips + (grabPts > 0 ? 1 : 0),
    spin: deg,
    switch: r.stance === -1,
    flips: turns,
    grab: grabPts > 0 ? grabT : 0,
    held: false,
  };
}
