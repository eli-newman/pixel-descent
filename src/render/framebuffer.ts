const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function pack(r: number, g: number, b: number): number {
  return LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

/** The whole game is white on black, with one yellow accent for UI. */
export const OFF = pack(0, 0, 0);
export const WHITE = pack(255, 255, 255);
export const YELLOW = pack(0xf5, 0xd7, 0x42);

/** A small RGBA pixel buffer with integer-only drawing. Pure data, so it works without a DOM. */
export class Framebuffer {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  private readonly px: Uint32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const buf = new ArrayBuffer(w * h * 4);
    this.data = new Uint8ClampedArray(buf);
    this.px = new Uint32Array(buf);
    this.clear();
  }

  clear(color: number = OFF): void {
    this.px.fill(color);
  }

  /** Set one pixel (coordinates are rounded, anything off-buffer is ignored). */
  put(x: number, y: number, color: number = WHITE): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = color;
  }

  erase(x: number, y: number): void {
    this.put(x, y, OFF);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return OFF;
    return this.px[y * this.w + x] ?? OFF;
  }

  isOn(x: number, y: number): boolean {
    return this.get(x, y) !== OFF;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number = WHITE): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, color);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: number = WHITE): void {
    for (let i = 0; i < w; i++) {
      this.put(x + i, y, color);
      this.put(x + i, y + h - 1, color);
    }
    for (let j = 0; j < h; j++) {
      this.put(x, y + j, color);
      this.put(x + w - 1, y + j, color);
    }
  }
}
