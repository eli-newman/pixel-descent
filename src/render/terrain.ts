import { W } from '../core/config';
import { hash2 } from '../core/rng';
import type { Ramp } from '../sim/types';
import type { DeepReadonly } from '../state/view';
import type { Framebuffer } from './framebuffer';
import { C } from './palette';

/** How tall a kicker is for its cast shadow, in pixels at the lip. */
export const RAMP_HEIGHT = 8;
/** Rows of a kicker's face, from its back edge down to the lip. */
export const RAMP_ROWS = 17;

/** Half width of a kicker's face on row `i` (0 is the back edge, `RAMP_ROWS - 1` the lip). */
export function rampHalfAt(half: number, i: number): number {
  return Math.round(half * (0.55 + (0.45 * i) / (RAMP_ROWS - 1)));
}

/** Size of a jump line pip and the step from one to the next, in px. */
const PIP = 3;
const PIP_STEP = 5;

/**
 * The pips over a kicker in a jump line, one per kicker in the line, in a row just uphill of its back
 * edge: filled up to this kicker's place in the line, hollow after it, so "2 of 3" reads at a glance and
 * every kicker of a line looks related. Empty for a kicker that is not in a line. Screen y.
 */
export function linePips(
  r: DeepReadonly<Ramp>,
  cam: number,
): { x: number; y: number; size: number; filled: boolean }[] {
  if (r.lineLen < 2) return [];
  const x0 = Math.round(r.x - (PIP_STEP * r.lineLen - (PIP_STEP - PIP)) / 2);
  const y = r.y - cam - RAMP_ROWS - 4;
  return Array.from({ length: r.lineLen }, (_, k) => ({
    x: x0 + k * PIP_STEP,
    y,
    size: PIP,
    filled: k <= r.lineIdx,
  }));
}

// ---------------------------------------------------------------------------------------------
// Colour mode only: the jumps and cliffs drawn the way they look on a real slope. The black and white
// versions stay in scene.ts. Every texture here is keyed to world coordinates (or to the cliff's own
// lip), never to the screen, so nothing shimmers as the slope scrolls.

/**
 * A packed snow kicker, shaped by light alone: the face catches the sun on the left and falls into shade on the
 * right, faint groomer lines run down it, the lip is a bright edge with a dark drop under it, and it casts a
 * shadow. Orange marker poles at the lip corners, like a real terrain park, make it easy to spot at speed.
 */
export function drawColorKicker(fb: Framebuffer, r: DeepReadonly<Ramp>, cam: number): void {
  const ly = r.y - cam;
  const rows = RAMP_ROWS;
  // Cast shadow: the same rule as the black and white kicker and the tree sprites.
  for (let i = 0; i < rows; i++) {
    const hw = rampHalfAt(r.half, i);
    const h = 1 + ((RAMP_HEIGHT - 1) * i) / (rows - 1);
    const wy = r.y - (rows - 1) + i;
    const sy = Math.round(wy + 1 + h * 0.28);
    for (let dx = -hw; dx <= hw; dx++) {
      const sx = Math.round(r.x + dx + h * 0.85 + 1);
      if ((sx + sy) % 2 === 0) fb.put(sx, sy - cam, C.snowShade);
    }
  }
  for (let i = 0; i < rows; i++) {
    const hw = rampHalfAt(r.half, i);
    const wy = r.y - (rows - 1) + i;
    const rise = i / (rows - 1);
    for (let dx = -hw; dx <= hw; dx++) {
      const u = (dx + hw) / (2 * hw);
      // Light falls off to the right. A checker between the bands hides the steps.
      const k = u + ((dx + wy) % 2 === 0 ? 0.06 : -0.06);
      let c: number =
        k < 0.5 ? (rise > 0.4 ? C.snowLit : C.snowMid) : k < 0.78 ? C.snowMid : C.snowShade;
      // groomer lines down the face
      if (dx % 3 === 0 && u > 0.1 && u < 0.9 && i > 1) c = u < 0.55 ? C.snowMid : C.snowShade;
      if (dx === hw) c = C.snowEdge;
      if (dx === -hw) c = C.snowMid;
      if (i === 0) c = dx > hw * 0.3 ? C.snowEdge : C.snowMid;
      fb.put(r.x + dx, wy - cam, c);
    }
  }
  // the lip: a bright rounded edge, then the drop
  for (let dx = -r.half; dx <= r.half; dx++) {
    fb.put(r.x + dx, ly, C.snowLit);
    fb.put(r.x + dx, ly + 1, C.snowDeep);
    if ((r.x + dx + r.y) % 2 === 0) fb.put(r.x + dx, ly + 2, C.snowEdge);
  }
  // marker poles at the lip corners, each with a little shadow
  for (const s of [-1, 1]) {
    const x = r.x + s * (r.half + 2);
    for (let y = ly - 6; y <= ly; y++) fb.put(x, y, y < ly - 4 ? C.poleTip : C.pole);
    fb.put(x + 1, ly + 1, C.snowShade);
  }
  // a jump line's pips, in the poles' orange
  for (const p of linePips(r, cam)) {
    if (p.filled) fb.fillRect(p.x, p.y, p.size, p.size, C.pole);
    else fb.strokeRect(p.x, p.y, p.size, p.size, C.poleTip);
  }
}

/** Smooth value noise in [0, 1) along one axis, for lips and faces that wander instead of stepping. */
function noise(x: number, k: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hash2(i, k) * (1 - s) + hash2(i + 1, k) * s;
}

/**
 * A natural rock band: a lip that wanders smoothly and rounds off at the ends, a face lit from the left that
 * darkens towards its foot, vertical ribs and gullies instead of a brick grid, a pillow of snow on top, and a soft
 * blue shadow on the snow below. Between and beside the chunks is open slope, as in black and white, and the red
 * warning chevron sits above each chunk.
 */
export function drawColorCliff(fb: Framebuffer, r: DeepReadonly<Ramp>, ly: number): void {
  const sd = r.seed * 7;
  for (let x = 0; x < W; x++) {
    const seg = r.segs.find((c) => x >= c.x0 && x < c.x1);
    if (!seg) {
      // open slope: plain snow, so nothing shimmers between the rock
      for (let y = ly - 4; y <= ly + 34; y++) fb.put(x, y, C.snow);
      continue;
    }
    const edge = Math.min(x - seg.x0, seg.x1 - 1 - x);
    const end = Math.min(1, Math.sqrt(edge / 9));
    const lip = Math.round(ly + seg.dy + (noise(x / 7, sd + 1) - 0.5) * 5 + (1 - end) * 6);
    const faceH = Math.max(3, Math.round((13 + noise(x / 9, sd + 2) * 9) * end));
    const foot = lip + faceH;
    for (let y = lip - 4; y <= foot + 5; y++) fb.put(x, y, C.snow);
    // ribs catch the light, gullies are dark cracks running down the face
    const rib = noise(x / 3.5, sd + 3);
    const gully =
      hash2(x + sd, 4) > 0.9 || x % 9 === Math.floor(hash2(Math.floor(x / 9) + sd, 5) * 9);
    for (let y = lip + 2; y < foot; y++) {
      const d = (y - lip - 2) / Math.max(1, faceH - 2);
      let c: number = d < 0.25 ? C.rockLit : d < 0.6 ? C.rockMid : C.rockLow;
      if (rib > 0.62 && d < 0.75) c = d < 0.3 ? C.rockHi : C.rockLit;
      if (rib < 0.3) c = d < 0.5 ? C.rockMid : C.rockLow;
      if (gully && d > 0.1) c = C.rockDeep;
      if (hash2(x * 7 + sd, (y - lip) * 3) > 0.96) c = C.rockDeep;
      // a little snow caught on the lit ribs
      if (
        !gully &&
        d > 0.2 &&
        d < 0.6 &&
        rib > 0.62 &&
        hash2(Math.floor(x / 4) + sd, y - lip) > 0.97
      ) {
        c = C.white;
      }
      fb.put(x, y, c);
    }
    // snow pillow on top, rounded, with a blue edge above and below so it never melts into the slope
    const cap = 2 + Math.round(noise(x / 5, sd + 7) * 1.4);
    for (let k = 0; k < cap; k++) fb.put(x, lip + 1 - k, C.white);
    fb.put(x, lip + 2, C.snowEdge);
    fb.put(x, lip + 1 - cap, C.snowShade);
    // the foot: dark where rock meets snow, then a soft shadow fading out
    fb.put(x, foot, C.rockDeep);
    fb.put(x, foot + 1, C.shadowNear);
    fb.put(x, foot + 2, C.shadowSoft);
    if ((x + foot - ly) % 2 === 0) fb.put(x, foot + 3, C.shadowSoft);
  }
  for (const c of r.segs) {
    const cx = Math.round((c.x0 + c.x1) / 2);
    for (let k = 0; k < 4; k++) {
      fb.put(cx - k, ly + c.dy - 10 + k, C.chevron);
      fb.put(cx + k, ly + c.dy - 10 + k, C.chevron);
    }
  }
}
