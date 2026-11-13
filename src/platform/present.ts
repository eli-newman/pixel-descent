import { W } from '../core/config';
import type { Fit } from './viewport';

/** The whole-number scale a layer is drawn at inside its canvas, before the page fits it to `scale` smoothly. */
export function sharpScale(scale: number): number {
  return Math.max(1, Math.ceil(scale - 1e-6));
}

/**
 * How many canvas pixels to slide the slope up for the camera's fraction `frac` of a logical pixel, when every logical
 * pixel is `n` canvas pixels: whole canvas pixels, never past one logical pixel (the spare row is all that shows).
 */
export function slideRows(frac: number, n: number): number {
  return Math.round(Math.min(1, Math.max(0, frac)) * n);
}

/** Where a layer canvas sits on the page, in CSS px. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The slope canvas's place: `rows` rows (the frame plus `fit.above` over it, and the rest below), at `fit`'s scale,
 * with the frame's first row on the frame's top edge.
 */
export function slopeBox(fit: Fit, dpr: number, rows: number): CssBox {
  return {
    left: fit.left,
    top: fit.top - (fit.above * fit.scale) / dpr,
    width: (W * fit.scale) / dpr,
    height: (rows * fit.scale) / dpr,
  };
}

/**
 * A canvas that shows a low-resolution picture crisply at any scale, fractional too. A plain nearest-neighbour stretch
 * by 6.55 makes every logical row 6 or 7 device pixels tall, so art scrolling past keeps changing shape. Instead the
 * picture is blown up inside the canvas by the next whole number (7: every pixel an equal square) and the page shrinks
 * the canvas smoothly to 6.55, which softens each edge by at most one device pixel and keeps every pixel the same size
 * wherever it is. At a whole scale the canvas is shown pixel for pixel.
 *
 * The slope's slide by a fraction of a pixel is drawn into the same canvas, so the picture and its slide always reach
 * the screen together (a CSS transform can land a frame apart from the pixels it moves).
 */
export class SharpCanvas {
  private readonly small = document.createElement('canvas');
  private readonly smallCtx: CanvasRenderingContext2D;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const small = this.small.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!small || !ctx) throw new Error('2D canvas is not supported');
    this.smallCtx = small;
    this.ctx = ctx;
  }

  /** Size the canvas for a `w` by `h` picture drawn `n` canvas pixels to a pixel. */
  resize(w: number, h: number, n: number): void {
    if (this.small.width !== w || this.small.height !== h) {
      this.small.width = w;
      this.small.height = h;
    }
    if (this.canvas.width !== w * n || this.canvas.height !== h * n) {
      this.canvas.width = w * n;
      this.canvas.height = h * n;
    }
  }

  /** Show `image` (the size given to `resize`), slid up by `slide` canvas pixels. */
  draw(image: ImageData, slide = 0): void {
    this.smallCtx.putImageData(image, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.small, 0, -slide, this.canvas.width, this.canvas.height);
  }
}
