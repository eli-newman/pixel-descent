import { Rng } from '../core/rng';
import { WHITE, type Framebuffer } from '../render/framebuffer';

/**
 * Flecks of powder in closed form. The game steps its particles (`state/effects.ts`): a jet throws each fleck up
 * the screen with a sideways spread, x slows with drag e^(-2t) and gravity pulls y back down at 60 px/s^2. Here the
 * same motion is solved for any time, so a burst can be drawn at any age, forwards or backwards, with no state.
 * Every other fleck that comes down stays on the snow as a grain for a while, as in the game.
 */
export interface Burst {
  /** Where the flecks start, and the line (unit vector, length in px) they are spread along. */
  x: number;
  y: number;
  alongX: number;
  alongY: number;
  length: number;
  /** Flecks thrown, and the seconds over which they leave, so a burst builds instead of popping. */
  count: number;
  emit: number;
  /** The game's jet: speed up the screen, sideways spread and the longest life of a fleck. */
  up: number;
  spread: number;
  life: number;
  /** Extra throw (unit vector, px/s) for every fleck, and the speed they share with the rider. */
  throwX: number;
  throwY: number;
  throwSpeed: number;
  carryX: number;
  carryY: number;
  /** Longest time a grain stays on the snow after it lands. */
  linger: number;
}

const DRAG = 2;
const GRAVITY = 60;
/** Only every other fleck leaves a grain behind, as in the game. */
const LAND_EVERY = 2;

/** Seconds from the start of a burst to the moment it draws nothing. */
export function burstDuration(b: Readonly<Burst>): number {
  return b.emit + b.life + b.linger;
}

/** Mix a seed and a salt into a PRNG stream, so different bursts from the same seed do not line up. */
export function burstRng(seed: number, salt: number): Rng {
  return new Rng((Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0);
}

export function drawBurst(fb: Framebuffer, b: Readonly<Burst>, age: number, rng: Rng): void {
  if (!(age >= 0) || age >= burstDuration(b)) return;
  for (let i = 0; i < b.count; i++) {
    // Always draw the same number of values per fleck, so fleck i is the same at every age.
    const birth = b.emit * rng.next();
    const life = b.life * (0.6 + rng.next() * 0.4);
    const spot = (rng.next() - 0.5) * b.length;
    const x0 = b.x + b.alongX * spot + (rng.next() - 0.5) * 6;
    const y0 = b.y + b.alongY * spot + (rng.next() - 0.5) * 3;
    const thrown = b.throwSpeed * (0.5 + 0.5 * rng.next());
    const vx = (rng.next() - 0.5) * 2 * b.spread + b.throwX * thrown + b.carryX;
    const vy = b.carryY + b.throwY * thrown - b.up * (0.55 + rng.next() * 0.6);
    const linger = b.linger * (0.35 + 0.65 * rng.next());
    const t = age - birth;
    if (t < 0) continue;
    const landed = t >= life;
    if (landed && (i % LAND_EVERY !== 0 || t >= life + linger)) continue;
    const s = landed ? life : t;
    const x = x0 + (vx * (1 - Math.exp(-DRAG * s))) / DRAG;
    const y = y0 + vy * s + 0.5 * GRAVITY * s * s;
    fb.put(x, y, WHITE);
  }
}
