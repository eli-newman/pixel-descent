import { H, W } from './config';

export interface Fit {
  /** Integer scale in device pixels per logical pixel. */
  scale: number;
  /** CSS size and position of the canvas, snapped to whole device pixels. */
  cssW: number;
  cssH: number;
  left: number;
  top: number;
}

/**
 * Largest whole-number scale at which the low-res canvas fits the window, centred and snapped to
 * device pixels so every logical pixel is a crisp, equal-sized square. The rest stays black.
 */
export function fitCanvas(viewW: number, viewH: number, dpr: number): Fit {
  const devW = viewW * dpr;
  const devH = viewH * dpr;
  const scale = Math.max(1, Math.floor(Math.min(devW / W, devH / H)));
  const left = Math.max(0, Math.floor((devW - W * scale) / 2)) / dpr;
  const top = Math.max(0, Math.floor((devH - H * scale) / 2)) / dpr;
  return { scale, cssW: (W * scale) / dpr, cssH: (H * scale) / dpr, left, top };
}
