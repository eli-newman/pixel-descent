import { START_X, START_Y } from '../core/config';

export type Face = 1 | -1;

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
