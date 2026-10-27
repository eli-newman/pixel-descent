import type { RiderPose } from '../rider';
import type { Framebuffer } from './framebuffer';

/** Scale of the rider relative to the original 240x480 art. Larger than the first version so it reads at 180x320. */
const SC = 0.85;
/** Board length in px: it runs from the rider's feet along the heading to the nose. */
export const BOARD_LEN = Math.round(23 * SC);

type Pt = readonly [number, number];

/** Looks the player can unlock: a board pattern and a headgear. Both are one-colour sprite swaps. */
export interface RiderStyle {
  /** 0 classic, 1 stripe, 2 dots, 3 twin tip. */
  board: number;
  /** 0 helmet, 1 beanie, 2 scarf, 3 ears. */
  rider: number;
}

export const DEFAULT_STYLE: RiderStyle = { board: 0, rider: 0 };

const GRID = 96;
const HALF = GRID / 2;

/**
 * A reusable bitmap window around the rider. Sprites are built into it with set/clear, then
 * stamped with a black outline. Reusing one buffer means drawing a rider allocates nothing.
 */
class Mask {
  private readonly bits = new Uint8Array(GRID * GRID);
  private readonly touched = new Int32Array(GRID * GRID);
  private n = 0;
  private ox = 0;
  private oy = 0;

  reset(cx: number, cy: number): void {
    for (let i = 0; i < this.n; i++) this.bits[this.touched[i] ?? 0] = 0;
    this.n = 0;
    this.ox = Math.round(cx) - HALF;
    this.oy = Math.round(cy) - HALF;
  }

  private idx(x: number, y: number): number {
    const lx = Math.round(x) - this.ox;
    const ly = Math.round(y) - this.oy;
    return lx < 0 || ly < 0 || lx >= GRID || ly >= GRID ? -1 : ly * GRID + lx;
  }

  add(x: number, y: number): void {
    const i = this.idx(x, y);
    if (i < 0 || this.bits[i] === 1) return;
    this.bits[i] = 1;
    this.touched[this.n++] = i;
  }

  delete(x: number, y: number): void {
    const i = this.idx(x, y);
    if (i >= 0) this.bits[i] = 0;
  }

  has(x: number, y: number): boolean {
    const i = this.idx(x, y);
    return i >= 0 && this.bits[i] === 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, th: number): void {
    const L = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= L; i++) {
      const t = i / L;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let k = 0; k < th; k++) this.add(x + k - (th - 1) / 2, y);
    }
  }

  /**
   * Squash the set vertically about its own middle by a (possibly negative) factor: the flip's
   * foreshortening. Every source pixel covers the rows it maps to, so thin results keep their
   * silhouette instead of dropping rows. Negative factors turn the figure upside down.
   */
  squashY(f: number): void {
    let m = 0;
    let lo = GRID;
    let hi = 0;
    for (let k = 0; k < this.n; k++) {
      const i = this.touched[k] ?? 0;
      if (this.bits[i] !== 1) continue;
      const y = Math.floor(i / GRID);
      scratch[m++] = i % GRID;
      scratch[m++] = y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    for (let k = 0; k < this.n; k++) this.bits[this.touched[k] ?? 0] = 0;
    this.n = 0;
    const py = (lo + hi + 1) / 2;
    for (let j = 0; j < m; j += 2) {
      const x = scratch[j] ?? 0;
      const y = scratch[j + 1] ?? 0;
      let a = py + (y - py) * f;
      let b = py + (y + 1 - py) * f;
      if (a > b) [a, b] = [b, a];
      const r0 = Math.ceil(a - 0.5);
      const r1 = Math.ceil(b - 0.5) - 1;
      if (r1 < r0) this.addLocal(x, Math.floor((a + b) / 2));
      else for (let r = r0; r <= r1; r++) this.addLocal(x, r);
    }
  }

  private addLocal(lx: number, ly: number): void {
    if (lx < 0 || ly < 0 || lx >= GRID || ly >= GRID) return;
    const i = ly * GRID + lx;
    if (this.bits[i] === 1) return;
    this.bits[i] = 1;
    this.touched[this.n++] = i;
  }

  /** Draw the set with a one pixel black halo so it reads on top of trees and snow. */
  stamp(fb: Framebuffer, ghost = false): void {
    const n = this.n;
    if (!ghost) {
      for (let k = 0; k < n; k++) {
        const i = this.touched[k] ?? 0;
        if (this.bits[i] !== 1) continue;
        const x = (i % GRID) + this.ox;
        const y = Math.floor(i / GRID) + this.oy;
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            if (!this.has(x + a, y + b)) fb.erase(x + a, y + b);
          }
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const i = this.touched[k] ?? 0;
      if (this.bits[i] !== 1) continue;
      const x = (i % GRID) + this.ox;
      const y = Math.floor(i / GRID) + this.oy;
      if (ghost && (x + y) % 2 !== 0) continue;
      fb.put(x, y);
    }
  }
}

const scratch = new Int32Array(GRID * GRID * 2);
const mask = new Mask();
const fill = new Mask();

/** How much of the depth axis shows in a flip: the head leads forward or back by this share of its height. */
const FLIP_DEPTH = 0.5;
/** A flip never squashes thinner than this, so the rider stays a visible sliver edge on. */
const FLIP_MIN = 0.36;

/**
 * Vertical scale of the sprite at a flip angle (degrees, positive is a backflip). The body rotates
 * about the waist: its height shows as cos, and its depth (the head swinging back or forward)
 * adds a share of sin, so a backflip and a frontflip squash differently. Negative is upside down.
 */
export function flipScale(pitch: number): number {
  const a = (pitch * Math.PI) / 180;
  const f = Math.cos(a) + FLIP_DEPTH * Math.sin(a);
  return Math.abs(f) < FLIP_MIN ? (f < 0 ? -FLIP_MIN : FLIP_MIN) : f;
}

/** 0..1 limb tuck during a flip: knees up and arms folded in, deepest edge on. */
export function flipTuck(pitch: number): number {
  const a = (pitch * Math.PI) / 180;
  return Math.min(1, 1.6 * Math.abs(Math.sin(a)));
}

export interface DrawOptions {
  style?: RiderStyle;
  /** Draw as a dithered, outline-free silhouette (the replay ghost). */
  ghost?: boolean;
  /** Seconds, for the fluttering scarf. */
  time?: number;
}

/**
 * The solved snowboarder from the original art. The heading drives the board, lean and stance
 * continuously, and the legs are solved to land exactly on the board so both feet stay planted.
 * Going straight downhill at speed (pose.tuck) drops the rider into a low crouch with the board
 * drawn as a long outline pointing straight down the screen.
 */
export function drawRider(fb: Framebuffer, pose: RiderPose, opts: DrawOptions = {}): void {
  const style = opts.style ?? DEFAULT_STYLE;
  const { x: rx, y: ry, nx, ny, face: mv, up, ang, steep } = pose;
  // Mid-flip the rider tucks his limbs in; upright (or a full turn) changes nothing.
  const tuck = Math.max(pose.tuck, flipTuck(pose.pitch));
  const flipping = Math.abs(Math.sin((pose.pitch * Math.PI) / 360)) > 0.004;
  const n: Pt = [nx, ny];
  mask.reset(rx, ry - 10);
  const set = mask;

  // board: tail on the track head, solid capsule, outlined when it points steeply downhill
  {
    fill.reset(rx, ry - 10);
    const BLEN = BOARD_LEN;
    const hw = steep ? 2.3 : 1.5;
    const y0 = Math.floor(Math.min(ry, ry + n[1] * BLEN)) - 4;
    const y1 = Math.ceil(Math.max(ry, ry + n[1] * BLEN)) + 4;
    const x0 = Math.floor(Math.min(rx, rx + n[0] * BLEN)) - 4;
    const x1 = Math.ceil(Math.max(rx, rx + n[0] * BLEN)) + 4;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const wx = x - rx;
        const wy = y - ry;
        const u = Math.max(0, Math.min(BLEN, wx * n[0] + wy * n[1]));
        const tip = Math.min(u, BLEN - u);
        const w = hw * Math.min(1, 0.45 + tip / 4);
        const curl = -Math.pow(Math.max(0, (u - BLEN + 5) / 5), 2) * 2 * (1 - ang / 110);
        if (Math.hypot(wx - n[0] * u, wy - n[1] * u - curl) <= w) fill.add(x, y);
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!fill.has(x, y)) continue;
        const interior =
          fill.has(x + 1, y) && fill.has(x - 1, y) && fill.has(x, y + 1) && fill.has(x, y - 1);
        if (!steep || !interior) set.add(x, y);
      }
    }
    // Board pattern: toggle pixels down the middle (filled in where the board is hollow, cut out where it is solid).
    const toggle = (u: number): void => {
      const px = rx + n[0] * u;
      const py = ry + n[1] * u;
      if (steep) set.add(px, py);
      else set.delete(px, py);
    };
    for (let u = 3; u < BLEN - 2; u++) {
      if (style.board === 1 && u % 4 < 2) toggle(u);
      if (style.board === 2 && u % 4 === 1) toggle(u);
    }
    if (style.board === 3) {
      // twin tip: notch both ends
      set.delete(rx + n[0] * 0.5, ry + n[1] * 0.5);
      set.delete(rx + n[0] * (BLEN - 0.5), ry + n[1] * (BLEN - 0.5));
    }
  }

  // rider: legs are solved to land exactly on the board
  const along = (u: number): Pt => [rx + n[0] * u, ry + n[1] * u];
  const M = along(11.5 * SC);
  const FF = along(17 * SC);
  const FB = along(6 * SC);
  const crouch = tuck * 0.55;
  const stand = (4 + 3 * up) * SC * (1 - crouch);
  // Toe side (heading left): chest to the camera, leaning into the turn, goggles visible.
  // Heel side (heading right): back to the camera, leaning back over the heels with hips out.
  const heel = mv > 0;
  const lean = (heel ? -2.5 : 3) * up;
  const hip: Pt = [M[0] - n[0] * (heel ? -1.5 : 1.5) * SC, M[1] - stand - 2 * SC];
  // In the tuck the shoulders drop and push forward along the board.
  const sh: Pt = [
    hip[0] + mv * lean * SC + n[0] * tuck * 4 * SC,
    hip[1] - 6 * SC * (1 - 0.3 * tuck) + n[1] * tuck * 1.5 * SC,
  ];
  const head: Pt = [sh[0] + mv * (heel ? -0.5 : 1.5) * SC + n[0] * tuck * 2 * SC, sh[1] - 4 * SC];
  const knee = (f: Pt): Pt => [
    (hip[0] + f[0]) / 2 + n[0] * ((heel ? 1.2 : 3.2) + tuck * 2) * SC,
    (hip[1] + f[1]) / 2 - 0.5,
  ];
  const ff: Pt = [FF[0], FF[1] - 1];
  const fb2: Pt = [FB[0], FB[1] - 1];
  const kf = knee(ff);
  const kb = knee(fb2);
  set.line(hip[0], hip[1], kf[0], kf[1], 2);
  set.line(kf[0], kf[1], ff[0], ff[1], 2);
  set.line(hip[0], hip[1], kb[0], kb[1], 2);
  set.line(kb[0], kb[1], fb2[0], fb2[1], 2);
  set.line(hip[0], hip[1], sh[0], sh[1], 3); // torso
  const rear = steep && pose.ang > 74;
  if (rear) {
    // Straight downhill the rider is seen almost head on: broad shoulders, arms hanging to the sides.
    set.line(sh[0] - 4, sh[1], sh[0] + 4, sh[1], 2);
    set.line(sh[0] - 4, sh[1], hip[0] - 4, hip[1] - 1 + tuck * 3, 1);
    set.line(sh[0] + 4, sh[1], hip[0] + 4, hip[1] - 1 + tuck * 3, 1);
    set.line(hip[0] - 2, hip[1], hip[0] + 2, hip[1], 2);
  }
  if (rear) {
    // arms already drawn
  } else if (tuck > 0.45) {
    // arms folded in against the body, hands near the knees
    set.line(sh[0], sh[1] + 1, kf[0], kf[1] - 1, 1);
    set.line(sh[0], sh[1] + 1, kb[0], kb[1] - 1, 1);
  } else {
    set.line(
      sh[0],
      sh[1] + 1,
      sh[0] + n[0] * 9 * SC,
      sh[1] + 1 + n[1] * 5 * SC - (heel ? 2 * SC : 0),
      1,
    ); // front arm reaches along the board
    set.line(sh[0], sh[1] + 1, sh[0] - n[0] * 4 * SC, sh[1] + 4 * SC, 1); // back arm
  }
  for (let j = 0; j < 3; j++) for (let i = -2; i <= 1; i++) set.add(head[0] + i, head[1] - 1 + j); // helmet
  if (rear) {
    set.add(head[0] + 2, head[1]);
    set.add(head[0] + 2, head[1] + 1);
    set.add(head[0] - 3, head[1]);
    set.add(head[0] - 3, head[1] + 1);
  }
  headgear(set, style.rider, head, mv, opts.time ?? 0);
  if (!heel) {
    // goggles: a hollow lens on the front of the helmet
    const gx = head[0] + (mv > 0 ? 1 : -2);
    const gy = head[1];
    set.delete(gx, gy);
    set.delete(gx - mv, gy);
  } else {
    // back of the helmet: a vent slot, no face
    set.delete(head[0], head[1] + 1);
    set.delete(head[0] - 1, head[1] + 1);
  }
  if (flipping) set.squashY(flipScale(pose.pitch));
  set.stamp(fb, opts.ghost === true);
}

/** Unlockable headgear: a bobble hat, a fluttering scarf or a pair of ears. */
function headgear(set: Mask, kind: number, head: Pt, mv: 1 | -1, time: number): void {
  const [hx, hy] = head;
  if (kind === 1) {
    for (let i = -2; i <= 1; i++) set.add(hx + i, hy - 2); // taller hat
    set.add(hx - 1, hy - 3);
    set.add(hx, hy - 3);
    set.add(hx - 1, hy - 4); // bobble
    set.add(hx, hy - 4);
  } else if (kind === 2) {
    // scarf at the neck streaming out behind, rippling with time
    for (let k = 1; k <= 7; k++) {
      const wave = Math.round(Math.sin(time * 14 + k * 0.9) * (0.4 + k * 0.18));
      set.add(hx - mv * (k + 1), hy + 3 + wave);
      if (k < 3) set.add(hx - mv * (k + 1), hy + 4 + wave);
    }
  } else if (kind === 3) {
    set.add(hx - 1, hy - 2);
    set.add(hx - 1, hy - 3);
    set.add(hx - 1, hy - 4);
    set.add(hx + 1, hy - 2);
    set.add(hx + 1, hy - 3);
    set.add(hx + 1, hy - 4);
    set.add(hx + 2 * mv, hy - 4);
  }
}

/** Powder cloud on steep sections and spray flecks flying off the tail, looping with time. `tuck` stretches the plume. */
export function drawSnowKick(
  fb: Framebuffer,
  pose: RiderPose,
  time: number,
  tuck = 0,
  air = false,
): void {
  if (air) return;
  const { x: rx, y: ry, nx, ny, ang } = pose;
  const dx = -ny;
  const dy = nx;
  const long = 1 + tuck * 1.2;
  if (ang > 55) {
    const n = 9 + Math.round(tuck * 6);
    for (let k = 0; k < n; k++) {
      const ph = (time * 1.2 + k / n) % 1;
      fb.put(
        rx - nx * (2 + ph * 10 * long) + ((k % 3) - 1) * 3 * ph,
        ry - ny * (2 + ph * 10 * long) - ph * 6 * (k % 2 ? 1 : 0.5),
      );
    }
  }
  for (let k = 0; k < 7; k++) {
    const ph = (time * 1.6 + k / 7) % 1;
    const back = 2 + ph * 14 * long;
    const rise = ph * (4 + (k % 3) * 2) - 1;
    if (ph < 0.8 && (k + Math.floor(time * 6)) % 3 !== 0) {
      fb.put(rx - nx * back + dx * (2 - rise), ry - ny * back + dy * (2 - rise) - rise * 0.4);
    }
  }
}

/**
 * A wipeout: the rider tumbles through the air, lands, and lies in the snow. Drawn as a small
 * stick figure rotated about its middle, in the same one-colour style as the riding pose.
 * `t` is seconds since the crash, `face` the side the rider was heading to.
 */
export function drawWipeout(fb: Framebuffer, x: number, y: number, t: number, face: 1 | -1): void {
  const AIR = 0.75;
  const p = Math.min(1, t / AIR);
  const ease = 1 - Math.pow(1 - p, 2);
  const phi = face * ease * (Math.PI * 4 + Math.PI / 2);
  let lift = 16 * Math.sin(Math.PI * p);
  if (t > AIR) lift = 2.5 * Math.abs(Math.sin((t - AIR) * 9)) * Math.exp(-(t - AIR) * 5);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const pivot: Pt = [0, -6];
  const tx = (px: number, py: number): Pt => {
    const ox = px - pivot[0];
    const oy = py - pivot[1];
    return [x + pivot[0] + ox * cos - oy * sin, y - lift + pivot[1] + ox * sin + oy * cos];
  };
  const set = mask;
  set.reset(x, y - 8);
  const seg = (a: Pt, b: Pt, th: number): void => {
    const A = tx(a[0], a[1]);
    const B = tx(b[0], b[1]);
    set.line(A[0], A[1], B[0], B[1], th);
  };
  seg([-9, 0], [9, 0], 2); // board
  seg([-3, -1], [0, -4], 1);
  seg([3, -1], [0, -4], 1); // legs
  seg([0, -4], [0, -11], 3); // torso
  seg([0, -10], [-4, -6], 1);
  seg([0, -10], [4, -13], 1); // flailing arms
  for (let j = 0; j < 3; j += 0.5) {
    for (let i = -2; i <= 1.5; i += 0.5) {
      const q = tx(i, -14 + j);
      set.add(q[0], q[1]);
    }
  }
  set.stamp(fb);
}

/** Little stars circling a rider who just wiped out. */
export function drawDizzy(fb: Framebuffer, x: number, y: number, time: number): void {
  for (let i = 0; i < 3; i++) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    const sx = Math.round(x + Math.cos(a) * 8);
    const sy = Math.round(y - 14 + Math.sin(a) * 2.5);
    fb.put(sx, sy);
    fb.put(sx - 1, sy);
    fb.put(sx + 1, sy);
    fb.put(sx, sy - 1);
    fb.put(sx, sy + 1);
  }
}
