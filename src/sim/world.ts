import { crossedY } from './collision';
import type { RiderState, Surface } from './riderState';
import type { Obstacle, Patch, Pickup, Ramp, SpawnBatch } from './types';

/** The live objects around the rider. */
export interface WorldLists {
  /** Kept sorted by y. */
  obstacles: Obstacle[];
  pickups: Pickup[];
  ramps: Ramp[];
  patches: Patch[];
}

/** Remove, in place, every element a predicate rejects. No new array is made. */
function compact<T>(arr: T[], keep: (t: T) => boolean): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (keep(v)) arr[w++] = v;
  }
  arr.length = w;
}

/** Insert into an array kept sorted by y. New items nearly always belong at the end. */
function insertByY(arr: Obstacle[], o: Obstacle): void {
  let i = arr.length;
  arr.push(o);
  while (i > 0 && arr[i - 1].y > o.y) {
    arr[i] = arr[i - 1];
    i--;
  }
  arr[i] = o;
}

export function addBatch(world: WorldLists, batch: SpawnBatch): void {
  for (const o of batch.obstacles) insertByY(world.obstacles, o);
  for (const p of batch.pickups) world.pickups.push(p);
  for (const ramp of batch.ramps) world.ramps.push(ramp);
  for (const p of batch.patches) world.patches.push(p);
}

/** Drop everything that has scrolled above `top`. In place, so a run allocates almost nothing. */
export function cullAbove(world: WorldLists, top: number): void {
  let drop = 0;
  while (drop < world.obstacles.length && world.obstacles[drop].y < top) drop++;
  if (drop > 0) world.obstacles.splice(0, drop);
  compact(world.pickups, (p) => p.y > top && !p.taken);
  compact(world.ramps, (q) => q.landEnd > top);
  compact(world.patches, (p) => p.y + p.ry > top);
}

/** Fill `out` with the surface under the rider's board at (x, y). */
export function surfaceAt(patches: readonly Patch[], x: number, y: number, out: Surface): void {
  const cy = y + 8;
  out.ice = false;
  out.drift = false;
  for (const p of patches) {
    if (Math.abs(p.y - cy) > p.ry) continue;
    const dx = (x - p.x) / p.rx;
    const dy = (cy - p.y) / p.ry;
    if (dx * dx + dy * dy >= 1) continue;
    if (p.kind === 'ice') out.ice = true;
    else out.drift = true;
  }
}

/** The ramp the rider just rode over and launches from, if any. Marks every ramp crossed as used. */
export function takeRamp(
  ramps: readonly Ramp[],
  r: Readonly<RiderState>,
  prevY: number,
  curY: number,
): Ramp | null {
  for (const ramp of ramps) {
    if (ramp.used || ramp.y < r.y - 40) continue;
    if (ramp.y > r.y + 60) break;
    if (!crossedY(prevY, curY, ramp.y)) continue;
    if (Math.abs(r.x - ramp.x) > ramp.half + 2) continue;
    ramp.used = true;
    // Only the rock drops you; the open slope between and beside the chunks is just a way down.
    if (ramp.kind === 'cliff' && !ramp.segs.some((c) => r.x >= c.x0 - 1 && r.x <= c.x1 + 1))
      continue;
    return ramp;
  }
  return null;
}
