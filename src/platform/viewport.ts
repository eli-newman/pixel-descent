import { H, W } from '../core/config';

export interface Fit {
  /** Device pixels per logical pixel. Whole on desktop; on a phone filled edge to edge it can be fractional. */
  scale: number;
  /** CSS size and position of the 180x320 frame that holds the HUD and takes taps, snapped to device pixels. */
  cssW: number;
  cssH: number;
  left: number;
  top: number;
  /** Whole logical rows of slope drawn above and below the frame, so the slope reaches the screen's edges. */
  above: number;
  below: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The most slope rows drawn past either end of the frame. A 20:9 phone needs about 45. */
export const MAX_EXTRA_ROWS = 96;

/**
 * Where the 180x320 frame goes, at what scale, and how much slope to draw around it.
 *
 * With `fill` (a phone held upright), the frame fills the screen's whole width, at whatever scale that takes, with its top
 * just under the notch, so the score sits where a phone's status bar ends and the rider sees further ahead. At three device pixels per CSS pixel an uneven
 * column now and then cannot be seen, and a black border could. Otherwise (desktop, or a screen wider than the
 * frame) it uses the largest whole scale that fits, so every logical pixel is a crisp, equal square, and keeps
 * `margin` CSS px clear. Either way the slope carries on past the top and bottom of the frame to the screen's edges.
 */
export function fitCanvas(
  viewW: number,
  viewH: number,
  dpr: number,
  safe: Insets = NO_INSETS,
  margin = 0,
  fill = false,
): Fit {
  // Fit inside the safe area (notch, home bar, rounded corners).
  const regionW = (viewW - safe.left - safe.right) * dpr;
  const regionH = (viewH - safe.top - safe.bottom) * dpr;
  let scale: number;
  let left: number;
  let top: number;
  if (fill && regionW / W <= regionH / H) {
    scale = (viewW * dpr) / W;
    left = 0;
    top = Math.round(safe.top * dpr) / dpr;
  } else {
    scale = Math.max(
      1,
      Math.floor(Math.min((regionW - 2 * margin * dpr) / W, (regionH - 2 * margin * dpr) / H)),
    );
    left = (safe.left * dpr + Math.max(0, Math.floor((regionW - W * scale) / 2))) / dpr;
    top = (safe.top * dpr + Math.max(0, Math.floor((regionH - H * scale) / 2))) / dpr;
  }
  const cssW = (W * scale) / dpr;
  const cssH = (H * scale) / dpr;
  const rows = (css: number): number =>
    Math.min(MAX_EXTRA_ROWS, Math.max(0, Math.ceil((css * dpr) / scale)));
  return { scale, cssW, cssH, left, top, above: rows(top), below: rows(viewH - top - cssH) };
}
