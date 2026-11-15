import { H, W } from '../core/config';
import { isPebble } from '../sim/collision';
import { textWidth } from './font';
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

type WorldBox = { x0: number; y0: number; x1: number; y1: number };

/** An obstacle's sprite in world pixels, from its top to its base. */
function obstacleSprite(o: {
  readonly kind: Parameters<typeof getSprite>[0];
  readonly size: number;
  readonly variant: number;
  readonly x: number;
  readonly y: number;
  readonly half: number;
}): WorldBox {
  const top = getSprite(o.kind, o.size, o.variant).top;
  return { x0: o.x - o.half, y0: o.y + top, x1: o.x + o.half, y1: o.y + 1 };
}

/** A world box on screen, with `PAD` around it, kept inside the frame's columns. */
function toFrame(box: Readonly<WorldBox>, cam: number): FrameBox {
  const x0 = Math.max(1, Math.floor(box.x0) - PAD);
  const x1 = Math.min(W - 2, Math.ceil(box.x1) + PAD);
  const y0 = Math.floor(box.y0) - cam - PAD;
  const y1 = Math.ceil(box.y1) - cam + PAD;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Where the thing a tutorial lesson is about sits on screen, in frame pixels, with a little room around it: the
 * spot the marker frames and the fade behind the lesson leaves clear. Null for a lesson about no one thing.
 */
export function lessonTarget(g: GameView): FrameBox | null {
  const t = g.lesson?.target;
  if (!t) return null;
  const sim = g.sim;
  const cam = g.camYi;
  let box: WorldBox | null = null;
  switch (t.list) {
    case 'obstacles': {
      const o = sim.obstacles.find((e) => e.id === t.id);
      if (o) box = obstacleSprite(o);
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
  return box ? toFrame(box, cam) : null;
}

function overlap(a: Readonly<FrameBox>, b: Readonly<FrameBox>, gap = 0): boolean {
  return (
    a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h
  );
}

/** Boxes that overlap or touch, joined into the box around both, until none do. */
function merged(boxes: readonly Readonly<FrameBox>[]): FrameBox[] {
  const out = [...boxes];
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (!a || !b || !overlap(a, b, 2)) continue;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      out[i] = {
        x,
        y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
      };
      out.splice(j, 1);
      // the grown box may now touch one already passed
      i = -1;
      break;
    }
  }
  return out;
}

/**
 * Every box a lesson marks, and the page's fade leaves clear. The crash lesson marks everything ahead of the rider
 * on screen that ends a run (every tree, rock and bush, never a pebble), boxes that touch joined into one; any
 * other lesson marks its one thing. A box under the lesson's words is left out, so the words stay readable.
 */
export function lessonBoxes(g: GameView): FrameBox[] {
  const lesson = g.lesson;
  if (!lesson) return [];
  const rows = lessonRows(lesson);
  const top = lessonTop(g, rows);
  // the words' own width (title at 3x, lines at 2x, how to go on at 1x), centred, with a pixel of edge
  const wide = Math.max(
    textWidth(lesson.title, 3),
    textWidth('SPACE TO GO ON'),
    ...lesson.lines.map((l) => textWidth(l, 2)),
  );
  const words: FrameBox = { x: Math.floor((W - wide) / 2) - 2, y: top, w: wide + 4, h: rows };
  const clear = (b: Readonly<FrameBox>): boolean => !overlap(b, words) && b.y + b.h > 0 && b.y < H;
  if (lesson.id !== 'crash') {
    const one = lessonTarget(g);
    return one ? [one] : [];
  }
  const sim = g.sim;
  const boxes: FrameBox[] = [];
  for (const o of sim.obstacles) {
    if (isPebble(o.kind, o.size) || o.y <= sim.rider.y + 4) continue;
    const b = toFrame(obstacleSprite(o), g.camYi);
    if (clear(b)) boxes.push(b);
  }
  return merged(boxes).filter(clear);
}

/** Rows of the title at three times the font size, of one line at twice it, and of "TAP TO GO ON" under them. */
export const LESSON_TITLE = 19;
export const LESSON_LINE = 13;
export const LESSON_GO = 10;
/** The HUD fades out under a lesson, so its words may start this near the top. */
const TOP = 10;

/** A lesson's whole block of words, in rows: title, lines and how to go on. */
export function lessonRows(lesson: { readonly lines: readonly string[] }): number {
  return LESSON_TITLE + lesson.lines.length * LESSON_LINE + LESSON_GO;
}

/**
 * The top row of a lesson's words: above the rider if they fit there, else under the thing the lesson points at,
 * else under the rider. `rows` is the block's height.
 */
export function lessonTop(g: GameView, rows: number): number {
  const rider = riderBox(g.sim, g.camYi);
  const target = lessonTarget(g);
  if (TOP + rows <= rider.top + 6) return TOP;
  const below = Math.max(rider.bottom, target ? target.y + target.h : 0) + 6;
  if (below + rows <= H - 30) return below;
  return Math.min(H - 30 - rows, rider.bottom + 6);
}
