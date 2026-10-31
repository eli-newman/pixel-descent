import { BOARD_LEN } from '../core/config';
import { poseOf } from '../sim/pose';
import { type RiderState } from '../sim/riderState';

/** Fixed size particle pool: jets never allocate, and stepping compacts in place. */
export class Particles {
  readonly x: Float32Array;
  readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  count = 0;

  constructor(readonly capacity = 256) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Throw `n` flecks mostly straight up (towards the top of the screen) with a sideways spread,
   * like a plume of powder. Gravity pulls them back down.
   */
  jet(
    x: number,
    y: number,
    n: number,
    up: number,
    spread: number,
    life: number,
    rand: () => number,
    carry = 0,
  ): void {
    for (let i = 0; i < n && this.count < this.capacity; i++) {
      const k = this.count++;
      this.x[k] = x + (rand() - 0.5) * 6;
      this.y[k] = y + (rand() - 0.5) * 3;
      this.vx[k] = (rand() - 0.5) * 2 * spread;
      this.vy[k] = carry - up * (0.55 + rand() * 0.6);
      this.max[k] = life;
      this.life[k] = life * (0.6 + rand() * 0.4);
    }
  }

  step(dt: number): void {
    const drag = Math.exp(-2 * dt);
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const life = (this.life[i] ?? 0) - dt;
      if (life <= 0) continue;
      const vy = (this.vy[i] ?? 0) + 60 * dt;
      const vx = (this.vx[i] ?? 0) * drag;
      this.x[w] = (this.x[i] ?? 0) + vx * dt;
      this.y[w] = (this.y[i] ?? 0) + vy * dt;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.life[w] = life;
      this.max[w] = this.max[i] ?? 0;
      w++;
    }
    this.count = w;
  }
}

/** Plowing sideways skids the board's flat base through the snow. The plume scales with speed and builds the longer the skid is held. */
export class BrakeSpray {
  private tick = 0;
  /** Seconds the current skid has been held; the plume builds with it. */
  private skid = 0;

  reset(): void {
    this.skid = 0;
  }

  step(r: RiderState, particles: Particles, rand: () => number): void {
    const dt = 1 / 120;
    const skidding = r.brake >= 0.35 && !r.air && r.speed >= 36;
    this.skid = skidding ? this.skid + dt : Math.max(0, this.skid - 3 * dt);
    if (!skidding) return;
    // Even a cruising skid should read clearly, so speed only scales it from 55% up.
    const f = 0.55 + 0.45 * Math.min(1, Math.max(0, (r.speed - 36) / 150));
    const build = Math.min(1, 0.4 + this.skid / 0.5);
    this.tick++;
    if (this.tick % 3 !== 0) return;
    const power = f * build;
    // Particles live in world space, so they inherit the rider's downhill speed; otherwise they just fall behind as a trail.
    const n = Math.round(1 + 2 * power);
    const carry = r.speed;
    // The board is plowed sideways, so the powder is shoved up off its leading (nose) edge, not the tail.
    const pose = poseOf(r, r.x, r.y, 0);
    const nx = r.x + pose.nx * BOARD_LEN;
    const ny = r.y + pose.ny * BOARD_LEN;
    const mx = r.x + pose.nx * BOARD_LEN * 0.5;
    const my = r.y + pose.ny * BOARD_LEN * 0.5;
    particles.jet(nx, ny - 1, n, 70 + 80 * power, 22 + 8 * power, 0.75, rand, carry);
    particles.jet(mx, my - 1, n >> 1, 60 + 50 * power, 16, 0.6, rand, carry);
  }
}
