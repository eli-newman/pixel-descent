import { H, W } from '../core/config';
import type { Fit } from './viewport';

/** The whole-number scale a picture is blown up by before it is shrunk to a fractional `scale`. */
export function sharpScale(scale: number): number {
  return Math.max(1, Math.ceil(scale - 1e-6));
}

/**
 * How many device pixels to slide the slope up for the camera's fraction `frac` of a logical pixel, when every logical
 * pixel is `scale` device pixels: whole device pixels, never past one logical pixel (the spare row is all that shows).
 */
export function slideRows(frac: number, scale: number): number {
  return Math.round(Math.min(1, Math.max(0, frac)) * scale);
}

/**
 * Where a layer canvas sits on the page and how big its backing is. The backing is exactly the device pixels it
 * covers (`pxW` by `pxH`, `width` and `height` in CSS px), so the browser shows it pixel for pixel and never filters
 * it. `dy` is how far below the canvas's top edge, in device pixels (0 up to 1), the picture's first row starts.
 */
export interface LayerBox {
  left: number;
  top: number;
  width: number;
  height: number;
  pxW: number;
  pxH: number;
  dy: number;
}

/**
 * The slope canvas's place: `rows` rows (the frame plus `fit.above` over it, and the rest below), at `fit`'s scale,
 * with the frame's first row on the frame's top edge. The canvas starts on a whole device pixel, and the picture is
 * drawn `dy` lower inside it, so the frame lines up with the HUD exactly.
 */
export function slopeBox(fit: Fit, dpr: number, rows: number): LayerBox {
  const y = fit.top * dpr - fit.above * fit.scale;
  const top = Math.floor(y + 1e-6);
  const dy = Math.max(0, y - top);
  const pxW = Math.round(W * fit.scale);
  const pxH = Math.ceil(dy + rows * fit.scale - 1e-6);
  return { left: fit.left, top: top / dpr, width: pxW / dpr, height: pxH / dpr, pxW, pxH, dy };
}

/** The HUD canvas's place: exactly the frame, inside the frame's own box (`#stage`). */
export function frameBox(fit: Fit, dpr: number): LayerBox {
  const pxW = Math.round(W * fit.scale);
  const pxH = Math.round(H * fit.scale);
  return { left: 0, top: 0, width: pxW / dpr, height: pxH / dpr, pxW, pxH, dy: 0 };
}

/**
 * A canvas that shows a low-resolution picture crisply at any scale, fractional too, the same in every browser.
 *
 * A plain nearest-neighbour stretch by 6.55 makes every logical row 6 or 7 device pixels tall, so art scrolling past
 * keeps changing shape. Instead the picture is blown up by the next whole number (7: every pixel an equal square) and
 * shrunk to 6.55 with one bilinear pass, which softens each edge by at most one device pixel. That pass is done here,
 * into a canvas exactly the size of the screen area it covers, never by the browser: when the browser shrank the
 * canvas itself the whole game looked blurry on a phone, since how it filters a scaled canvas is its own choice. At a whole scale the picture is blown up
 * straight into the canvas, with no smoothing at all.
 *
 * The slope's slide by a fraction of a pixel is drawn into the same canvas, in whole device pixels, so the picture and
 * its slide always reach the screen together (a CSS transform can land a frame apart from the pixels it moves).
 */
export class SharpCanvas {
  private readonly small = document.createElement('canvas');
  private readonly big = document.createElement('canvas');
  private readonly smallCtx: CanvasRenderingContext2D;
  private readonly bigCtx: CanvasRenderingContext2D;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private whole = true;
  private dy = 0;
  /** The last picture shown and its slide, so an unchanged HUD is not drawn again. */
  private last: Uint32Array | null = null;
  private lastSlide = -1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const small = this.small.getContext('2d');
    const big = this.big.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!small || !big || !ctx) throw new Error('2D canvas is not supported');
    this.smallCtx = small;
    this.bigCtx = big;
    this.ctx = ctx;
  }

  /** Size the canvas for a `w` by `h` picture at `scale` device pixels to a pixel, placed by `box`. */
  resize(w: number, h: number, scale: number, box: LayerBox): void {
    this.scale = scale;
    this.dy = box.dy;
    const n = sharpScale(scale);
    this.whole = n === scale;
    setSize(this.small, w, h);
    setSize(this.big, this.whole ? 1 : w * n, this.whole ? 1 : h * n);
    setSize(this.canvas, box.pxW, box.pxH);
    const style = this.canvas.style;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
    this.last = null;
  }

  /** Show `image` (the size given to `resize`), slid up by `slide` device pixels. */
  draw(image: ImageData, slide = 0): void {
    const pixels = new Uint32Array(
      image.data.buffer,
      image.data.byteOffset,
      image.width * image.height,
    );
    if (slide === this.lastSlide && this.last && same(this.last, pixels)) return;
    if (!this.last || this.last.length !== pixels.length)
      this.last = new Uint32Array(pixels.length);
    this.last.set(pixels);
    this.lastSlide = slide;

    this.smallCtx.putImageData(image, 0, 0);
    const ctx = this.ctx;
    const w = image.width * this.scale;
    const h = image.height * this.scale;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.whole) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.small, 0, this.dy - slide, w, h);
      return;
    }
    const big = this.bigCtx;
    big.imageSmoothingEnabled = false;
    big.clearRect(0, 0, this.big.width, this.big.height);
    big.drawImage(this.small, 0, 0, this.big.width, this.big.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.big, 0, this.dy - slide, w, h);
  }
}

function setSize(c: HTMLCanvasElement, w: number, h: number): void {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}

function same(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
