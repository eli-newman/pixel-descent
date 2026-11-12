import { H } from '../core/config';
import type { SimView } from '../state/view';

export interface Rect {
  w: number;
  h: number;
}

/**
 * The block at the top left that holds the score. It has no box behind it, but the slope's snow texture is
 * kept out of it, so the numbers never fight with flecks.
 */
export function hudRect(big: boolean): Rect {
  return big ? { w: 92, h: 62 } : { w: 62, h: 34 };
}

/** Speed gauge bar width, and the area of the speed read-out at the bottom left (labels keep out of it). */
export const GAUGE_BAR = 52;
export function gaugeRect(big: boolean): { x: number; y: number; w: number; h: number } {
  const sc = big ? 2 : 1;
  return { x: 3, y: H - 8 * sc - 11, w: GAUGE_BAR + 2 + (big ? 20 : 0), h: 8 * sc + 8 };
}

/** Height of the rider above the snow in px: a parabola over the jump. */
export function riderZ(sim: SimView): number {
  const r = sim.rider;
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}

/**
 * The screen box the rider can cover: from above the helmet (with an arm thrown up) to below a board
 * pointing downhill, and most of a board length to either side.
 */
export function riderBox(
  sim: SimView,
  cam: number,
): { left: number; right: number; top: number; bottom: number } {
  const x = Math.round(sim.rider.x);
  const y = Math.round(sim.rider.y - cam) - Math.round(riderZ(sim));
  return { left: x - 16, right: x + 16, top: y - 34, bottom: y + 19 };
}
