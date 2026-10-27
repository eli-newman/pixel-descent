/** Fixed size particle pool: bursts never allocate, and stepping compacts in place. */
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

  /** Spray `n` flecks out of a point. `rand` is a cosmetic random source (never the sim's). */
  burst(x: number, y: number, n: number, speed: number, life: number, rand: () => number): void {
    for (let i = 0; i < n && this.count < this.capacity; i++) {
      const k = this.count++;
      const a = rand() * Math.PI * 2;
      const s = speed * (0.3 + rand() * 0.7);
      this.x[k] = x;
      this.y[k] = y;
      this.vx[k] = Math.cos(a) * s;
      this.vy[k] = Math.sin(a) * s * 0.7 - speed * 0.25;
      this.max[k] = life;
      this.life[k] = life * (0.6 + rand() * 0.4);
    }
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
