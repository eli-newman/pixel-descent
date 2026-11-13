import { H, W } from '../core/config';
import type { GameView } from '../state/view';
import { riderBox } from './layout';
import { getSprite } from './sprites';
import { RAMP_ROWS } from './terrain';

/** A box in the 180x320 frame's rows and columns. */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cliff's rock reaches this far over its lip line (the snow cap on a high step) and this far under it (the deepest face). */
const CLIFF_ABOVE = 5;
const CLIFF_FACE = 24;

/** Room left around the thing a lesson points at, inside its marker. */
const PAD = 3;

/**
 * Where the thing a tutorial lesson is about sits on screen, in frame pixels, with a little room around it: the
 * spot the marker frames and the fade behind the lesson leaves clear. Null for a lesson about no one thing.
 */
export function lessonTarget(g: GameView): FrameBox | null {
  const t = g.lesson?.target;
  if (!t) return null;
  const sim = g.sim;
  const cam = g.camYi;
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  switch (t.list) {
    case 'obstacles': {
      const o = sim.obstacles.find((e) => e.id === t.id);
      if (o) {
        const top = getSprite(o.kind, o.size, o.variant).top;
        box = { x0: o.x - o.half, y0: o.y + top, x1: o.x + o.half, y1: o.y + 1 };
      }
      break;
    }
    case 'pickups': {
      const p = sim.pickups.find((e) => e.id === t.id);
      if (p) box = { x0: p.x - 4, y0: p.y - 4, x1: p.x + 4, y1: p.y + 4 };
      break;
    }
    case 'ramps': {
      const r = sim.ramps.find((e) => e.id === t.id);
      if (r && r.kind === 'cliff' && r.segs.length > 0) {
        // the rock chunks only: from the highest lip to below the deepest face
        const x0 = Math.min(...r.segs.map((c) => c.x0));
        const x1 = Math.max(...r.segs.map((c) => c.x1)) - 1;
        const top = Math.min(...r.segs.map((c) => c.dy));
        const low = Math.max(...r.segs.map((c) => c.dy));
        box = { x0, y0: r.y + top - CLIFF_ABOVE, x1, y1: r.y + low + CLIFF_FACE };
      } else if (r) {
        box = { x0: r.x - r.half, y0: r.y - RAMP_ROWS, x1: r.x + r.half, y1: r.y + 2 };
      }
      break;
    }
  }
  if (!box) return null;
  const x0 = Math.max(1, Math.floor(box.x0) - PAD);
  const x1 = Math.min(W - 2, Math.ceil(box.x1) + PAD);
  const y0 = Math.floor(box.y0) - cam - PAD;
  const y1 = Math.ceil(box.y1) - cam + PAD;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Rows of one lesson line at twice the font size, and the gap under the block before "TAP TO GO ON". */
export const LESSON_LINE = 13;
const HUD_BOTTOM = 38;

/**
 * The top row of a lesson's words: between the score and the rider if they fit there, else under the thing the
 * lesson points at, else under the rider. `rows` is the block's height.
 */
export function lessonTop(g: GameView, rows: number): number {
  const rider = riderBox(g.sim, g.camYi);
  const target = lessonTarget(g);
  if (HUD_BOTTOM + rows <= rider.top + 6) return HUD_BOTTOM;
  const below = Math.max(rider.bottom, target ? target.y + target.h : 0) + 6;
  if (below + rows <= H - 30) return below;
  return Math.min(H - 30 - rows, rider.bottom + 6);
}
