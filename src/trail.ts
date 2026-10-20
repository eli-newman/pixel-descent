/** Fixed size ring buffer of recent board positions, so recording the trail never allocates. */
export class Trail {
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  push(x: number, y: number): void {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
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

  lastX(): number {
    return this.count > 0 ? this.x(this.count - 1) : NaN;
  }

  lastY(): number {
    return this.count > 0 ? this.y(this.count - 1) : NaN;
  }
}
