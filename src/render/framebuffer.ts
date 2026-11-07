const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function pack(r: number, g: number, b: number): number {
  return LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

type Rgb = readonly [number, number, number];

/**
 * The game is white on black, with one yellow accent for UI and greys, only for the shadow of the board's track.
 * `softGrey` is the same shadow on solid white, inside a side slip, where the darker grey would look harsh.
 * The packed colours below come from here, and so do the CSS colours the embed exports.
 */
export const PALETTE = {
  off: [0, 0, 0],
  white: [255, 255, 255],
  yellow: [0xf5, 0xd7, 0x42],
  grey: [0x6e, 0x6e, 0x6e],
  softGrey: [0xa8, 0xa8, 0xa8],
} as const satisfies Record<string, Rgb>;

function packRgb([r, g, b]: Rgb): number {
  return pack(r, g, b);
}

export const OFF = packRgb(PALETTE.off);
export const WHITE = packRgb(PALETTE.white);
export const YELLOW = packRgb(PALETTE.yellow);
export const GREY = packRgb(PALETTE.grey);
export const SOFT_GREY = packRgb(PALETTE.softGrey);

/** A small RGBA pixel buffer with integer-only drawing. Pure data, so it works without a DOM. */
export class Framebuffer {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  private readonly px: Uint32Array;

  /**
   * A new buffer cleared to black, or, given `data`, a view that draws straight into those RGBA bytes and leaves
   * them as they are (the embed draws onto the caller's transparent surface this way). `data` must hold exactly
   * w * h pixels and start on a 4 byte boundary.
   */
  constructor(
    readonly w: number,
    readonly h: number,
    // The bytes this buffer draws into: a drawing target, like a Framebuffer, so it has to be writable.
    // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
    data?: Uint8ClampedArray<ArrayBuffer>,
  ) {
    if (data) {
      if (data.length !== w * h * 4 || data.byteOffset % 4 !== 0) {
        throw new RangeError(`Framebuffer: expected ${w * h * 4} RGBA bytes on a 4 byte boundary`);
      }
      this.data = data;
      this.px = new Uint32Array(data.buffer, data.byteOffset, w * h);
      return;
    }
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
