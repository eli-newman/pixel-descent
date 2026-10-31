/** Fixed size ring buffer of recent board positions, so recording the trail never allocates. */
export class Trail {
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly nxs: Float32Array;
  private readonly nys: Float32Array;
  private head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.nxs = new Float32Array(capacity);
    this.nys = new Float32Array(capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** (nx, ny) points from the board tail (x, y) toward its nose, scaled by the brake, or is zero when not skidding: a skid scrapes the snow along the whole board. */
  push(x: number, y: number, nx = 0, ny = 0): void {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.nxs[this.head] = nx;
    this.nys[this.head] = ny;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Index 0 is the oldest point, count - 1 the newest. */
  x(i: number): number {
    return this.xs[(this.head - this.count + i + this.capacity * 2) % this.capacity] ?? 0;
  }

  y(i: number): number {
    return this.ys[(this.head - this.count + i + this.capacity * 2) % this.capacity] ?? 0;
  }

  nx(i: number): number {
    return this.nxs[(this.head - this.count + i + this.capacity * 2) % this.capacity] ?? 0;
  }

  ny(i: number): number {
    return this.nys[(this.head - this.count + i + this.capacity * 2) % this.capacity] ?? 0;
  }

  lastX(): number {
    return this.count > 0 ? this.x(this.count - 1) : NaN;
  }

  lastY(): number {
    return this.count > 0 ? this.y(this.count - 1) : NaN;
  }
}
