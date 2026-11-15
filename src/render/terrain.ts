import type { Ramp } from '../sim/types';
import type { DeepReadonly } from '../state/view';

/** How tall a kicker is for its cast shadow, in pixels at the lip. */
export const RAMP_HEIGHT = 8;
/** Rows of a kicker's face, from its back edge down to the lip. */
export const RAMP_ROWS = 17;

/** Half width of a kicker's face on row `i` (0 is the back edge, `RAMP_ROWS - 1` the lip). */
export function rampHalfAt(half: number, i: number): number {
  return Math.round(half * (0.55 + (0.45 * i) / (RAMP_ROWS - 1)));
}

/** Size of a jump line pip and the step from one to the next, in px. */
const PIP = 3;
const PIP_STEP = 5;

/**
 * The pips over a kicker in a jump line, one per kicker in the line, in a row just uphill of its back
 * edge: filled up to this kicker's place in the line, hollow after it, so "2 of 3" reads at a glance and
 * every kicker of a line looks related. Empty for a kicker that is not in a line. Screen y.
 */
export function linePips(
  r: DeepReadonly<Ramp>,
  cam: number,
): { x: number; y: number; size: number; filled: boolean }[] {
  if (r.lineLen < 2) return [];
  const x0 = Math.round(r.x - (PIP_STEP * r.lineLen - (PIP_STEP - PIP)) / 2);
  const y = r.y - cam - RAMP_ROWS - 4;
  return Array.from({ length: r.lineLen }, (_, k) => ({
    x: x0 + k * PIP_STEP,
    y,
    size: PIP,
    filled: k <= r.lineIdx,
  }));
}
