import { LINE_BONUS, LINE_MULTS } from '../core/config';
import { crossedY } from './collision';
import type { ScoreState } from './score';
import type { Ramp } from './types';

/**
 * A jump line building or ending. `landed` kickers of `len` are landed clean so far. `mult` is what the
 * next kicker's trick points will be multiplied by; `bonus` is paid once the whole line is clean (then
 * `landed === len`). `broken` says why a live line ended: a sloppy landing or a kicker ridden past.
 */
export interface LineEvent {
  type: 'line';
  landed: number;
  len: number;
  mult: number;
  bonus: number;
  broken: 'sloppy' | 'skip' | null;
}

/** The multiplier on the trick points of a clean landing at place `idx` (from 0) in a line. */
export function lineMult(idx: number): number {
  return LINE_MULTS[Math.min(idx, LINE_MULTS.length - 1)] ?? 1;
}

/**
 * Follows the jump line being ridden. A line is live from a clean landing off its first kicker; each
 * clean landing after that multiplies its trick points by `lineMult`, and landing the last kicker clean
 * pays `LINE_BONUS` per kicker. A sloppy landing, a bail or riding past the next kicker ends it.
 */
export class LineTracker {
  /** Id of the live line (0: none), kickers landed clean in it, and the next lip's y. */
  private id = 0;
  private landed = 0;
  private len = 0;
  private nextY = 0;
  /** The line kicker the rider is in the air from, if it counts for the live line. */
  private pending: Readonly<Ramp> | null = null;

  /** The rider took off from `ramp`. */
  launch(ramp: Readonly<Ramp>): void {
    if (ramp.line !== 0 && ramp.lineIdx === 0) {
      this.id = ramp.line;
      this.landed = 0;
      this.len = ramp.lineLen;
    }
    this.pending =
      ramp.line !== 0 && ramp.line === this.id && ramp.lineIdx === this.landed ? ramp : null;
  }

  /**
   * The rider touched down: `pts` trick points (0 on a sloppy landing), `clean` or not, at speed
   * multiplier `mult`. Pays the line's extra points into `score` and returns them with the event, if any.
   */
  land(
    clean: boolean,
    pts: number,
    mult: number,
    score: ScoreState,
  ): { extra: number; event: LineEvent | null } {
    const ramp = this.pending;
    this.pending = null;
    if (!ramp) return { extra: 0, event: null };
    if (!clean) {
      const live = this.landed > 0;
      const event = this.end('sloppy');
      return { extra: 0, event: live ? event : null };
    }
    const extra = Math.round(pts * (lineMult(ramp.lineIdx) - 1));
    this.landed += 1;
    let bonus = 0;
    if (this.landed >= this.len) {
      bonus = Math.round(LINE_BONUS * this.len * mult);
      this.id = 0;
    } else {
      // Every kicker but the last clears the slope right up to the next lip.
      this.nextY = ramp.landEnd;
    }
    score.trickPoints += extra + bonus;
    return {
      extra,
      event: {
        type: 'line',
        landed: this.landed,
        len: this.len,
        mult: lineMult(this.landed),
        bonus,
        broken: null,
      },
    };
  }

  /** The rider rode on the snow from `prevY` to `curY` without taking off: past the next kicker ends the line. */
  ride(prevY: number, curY: number): LineEvent | null {
    if (this.id === 0 || this.pending || this.landed === 0) return null;
    if (!crossedY(prevY, curY, this.nextY)) return null;
    return this.end('skip');
  }

  /** A crash ends any line. */
  crash(): void {
    this.id = 0;
    this.pending = null;
  }

  private end(why: 'sloppy' | 'skip'): LineEvent {
    const event: LineEvent = {
      type: 'line',
      landed: this.landed,
      len: this.len,
      mult: 1,
      bonus: 0,
      broken: why,
    };
    this.id = 0;
    this.landed = 0;
    return event;
  }
}
