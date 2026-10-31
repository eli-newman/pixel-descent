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

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Largest whole-number scale at which the low-res canvas fits the window, centred and snapped to
 * device pixels so every logical pixel is a crisp, equal-sized square. The rest stays black.
 */
export function fitCanvas(
  viewW: number,
  viewH: number,
  dpr: number,
  safe: Insets = NO_INSETS,
  margin = 0,
): Fit {
  // Fit inside the safe area (notch, home bar, rounded corners) and keep a margin so the HUD is never clipped.
  const regionW = (viewW - safe.left - safe.right) * dpr;
  const regionH = (viewH - safe.top - safe.bottom) * dpr;
  const scale = Math.max(
    1,
    Math.floor(Math.min((regionW - 2 * margin * dpr) / W, (regionH - 2 * margin * dpr) / H)),
  );
  const left = (safe.left * dpr + Math.max(0, Math.floor((regionW - W * scale) / 2))) / dpr;
  const top = (safe.top * dpr + Math.max(0, Math.floor((regionH - H * scale) / 2))) / dpr;
  return { scale, cssW: (W * scale) / dpr, cssH: (H * scale) / dpr, left, top };
}
