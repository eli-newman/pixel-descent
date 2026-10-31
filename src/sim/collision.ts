import type { Obstacle } from './types';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The rider's contact circle sits on the middle of the board, below the tail anchor. */
export const RIDER_RADIUS = 3;
export const RIDER_CENTER_DY = 8;
/** Passing a solid obstacle closer than this (in px) counts as a near miss. */
export const NEAR_MISS_PX = 5;

export type Hit = 'none' | 'slow' | 'crash';

export function riderCenter(r: Point): Point {
  return { x: r.x, y: r.y + RIDER_CENTER_DY };
}

/**
 * The collidable footprint of an obstacle: a thin strip around its base. Canopies and tops are
 * decoration, so the rider can brush past the upper part of a tree. Pebbles do not collide.
 */
export function obstacleBox(o: Obstacle): Box | null {
  switch (o.kind) {
    case 'tree': {
      const w = Math.max(2, Math.round(o.half * 0.7));
      return { x0: o.x - w, x1: o.x + w, y0: o.y - 5, y1: o.y + 1 };
    }
    case 'dead':
      return { x0: o.x - 2, x1: o.x + 2, y0: o.y - 6, y1: o.y + 1 };
    case 'rock': {
      if (o.size < 9) return null;
      const w = Math.max(3, o.size / 2 - 1);
      const h = Math.round(o.size * 0.72);
      return { x0: o.x - w, x1: o.x + w, y0: o.y - h * 0.55, y1: o.y + 1 };
    }
    case 'bush':
      return { x0: o.x - 7, x1: o.x + 7, y0: o.y - 4, y1: o.y + 1 };
  }
}

/** Distance from a point to a box (0 when inside). */
function distToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x0 - px, 0, px - b.x1);
  const dy = Math.max(b.y0 - py, 0, py - b.y1);
  return Math.hypot(dx, dy);
}

export function circleHitsBox(cx: number, cy: number, radius: number, b: Box): boolean {
  return distToBox(cx, cy, b) < radius;
}

/** What happens when the rider (anchor position) touches this obstacle right now. */
export function testObstacle(rider: Point, o: Obstacle): Hit {
  const box = obstacleBox(o);
  if (!box) return 'none';
  const c = riderCenter(rider);
  if (!circleHitsBox(c.x, c.y, RIDER_RADIUS, box)) return 'none';
  return o.kind === 'bush' ? 'slow' : 'crash';
}

/** Horizontal clearance (px) between the rider circle and a solid obstacle, or null if not solid. */
export function clearance(rider: Point, o: Obstacle): number | null {
  if (o.kind === 'bush') return null;
  const box = obstacleBox(o);
  if (!box) return null;
  const c = riderCenter(rider);
  return Math.max(box.x0 - c.x, 0, c.x - box.x1) - RIDER_RADIUS;
}

/** True when the rider's contact point went from above a line to on/below it this step. */
export function crossedY(prevY: number, curY: number, lineY: number): boolean {
  return prevY < lineY && curY >= lineY;
}
