import { BOARD_LEN, RIDER_SCALE as SC } from '../core/config';
import { heelSide, type RiderPose } from '../sim/pose';
import type { Framebuffer } from './framebuffer';
import { MONO, type Palette } from './palette';

type Pt = readonly [number, number];

/** Looks the player can unlock: a board pattern and a headgear. Both are one-colour sprite swaps. */
export interface RiderStyle {
  /** 0 classic, 1 stripe, 2 dots, 3 twin tip. On skis the same looks are drawn on the skis. */
  board: number;
  /** 0 helmet, 1 beanie, 2 scarf, 3 ears. */
  rider: number;
  /** A skier with two skis and poles instead of a snowboarder. */
  skis: boolean;
}

export const DEFAULT_STYLE: RiderStyle = { board: 0, rider: 0, skis: false };

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
  /** What newly added pixels are: 1 the body, 2 the board or skis. Only colour mode tells them apart. */
  paint: 1 | 2 = 1;

  reset(cx: number, cy: number): void {
    for (let i = 0; i < this.n; i++) this.bits[this.touched[i] ?? 0] = 0;
    this.n = 0;
    this.paint = 1;
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
    if (i < 0 || this.bits[i] !== 0) return;
    this.bits[i] = this.paint;
    this.touched[this.n++] = i;
  }

  delete(x: number, y: number): void {
    const i = this.idx(x, y);
    if (i >= 0) this.bits[i] = 0;
  }

  has(x: number, y: number): boolean {
    const i = this.idx(x, y);
    return i >= 0 && this.bits[i] !== 0;
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
      const v = this.bits[i] ?? 0;
      if (v === 0) continue;
      const y = Math.floor(i / GRID);
      scratch[m++] = i % GRID;
      scratch[m++] = y;
      scratch[m++] = v;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    for (let k = 0; k < this.n; k++) this.bits[this.touched[k] ?? 0] = 0;
    this.n = 0;
    const py = (lo + hi + 1) / 2;
    for (let j = 0; j < m; j += 3) {
      const x = scratch[j] ?? 0;
      const y = scratch[j + 1] ?? 0;
      const v = scratch[j + 2] === 2 ? 2 : 1;
      let a = py + (y - py) * f;
      let b = py + (y + 1 - py) * f;
      if (a > b) [a, b] = [b, a];
      const r0 = Math.ceil(a - 0.5);
      const r1 = Math.ceil(b - 0.5) - 1;
      if (r1 < r0) this.addLocal(x, Math.floor((a + b) / 2), v);
      else for (let r = r0; r <= r1; r++) this.addLocal(x, r, v);
    }
  }

  private addLocal(lx: number, ly: number, v: 1 | 2): void {
    if (lx < 0 || ly < 0 || lx >= GRID || ly >= GRID) return;
    const i = ly * GRID + lx;
    if (this.bits[i] !== 0) return;
    this.bits[i] = v;
    this.touched[this.n++] = i;
  }

  /** Draw the set with a one pixel halo (black, or a near black in colour) so it reads on top of trees and snow. */
  stamp(fb: Framebuffer, pal: Readonly<Palette>): void {
    const n = this.n;
    for (let k = 0; k < n; k++) {
      const i = this.touched[k] ?? 0;
      if (this.bits[i] === 0) continue;
      const x = (i % GRID) + this.ox;
      const y = Math.floor(i / GRID) + this.oy;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          if (!this.has(x + a, y + b)) fb.put(x + a, y + b, pal.riderHalo);
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const i = this.touched[k] ?? 0;
      const v = this.bits[i] ?? 0;
      if (v === 0) continue;
      const x = (i % GRID) + this.ox;
      const y = Math.floor(i / GRID) + this.oy;
      fb.put(x, y, v === 2 ? pal.riderBoard : pal.riderBody);
    }
  }
}

const scratch = new Int32Array(GRID * GRID * 3);
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
  /** Seconds, for the fluttering scarf. */
  time?: number;
  /** 0..1, how far into a stop the rider is. Only the skier shows it (a hockey stop). */
  brake?: number;
  /** The colours to draw in. Defaults to black and white. */
  palette?: Readonly<Palette>;
}

/**
 * The solved snowboarder from the original art. The heading drives the board, lean and stance
 * continuously, and the legs are solved to land exactly on the board so both feet stay planted.
 * Going straight downhill at speed (pose.tuck) drops the rider into a low crouch with the board
 * drawn as a long outline pointing straight down the screen.
 */
export function drawRider(
  fb: Framebuffer,
  pose: Readonly<RiderPose>,
  opts: Readonly<DrawOptions> = {},
): void {
  const style = opts.style ?? DEFAULT_STYLE;
  if (style.skis) {
    drawSkier(fb, pose, style, opts.time ?? 0, opts.brake ?? 0, opts.palette ?? MONO);
    return;
  }
  // Mid-flip the rider tucks his limbs in; upright (or a full turn) changes nothing.
  const tuck = Math.max(pose.tuck, flipTuck(pose.pitch));
  const flipping = Math.abs(Math.sin((pose.pitch * Math.PI) / 360)) > 0.004;
  mask.reset(pose.x, pose.y - 10);
  mask.paint = 2;
  maskBoard(mask, pose, style.board);
  mask.paint = 1;
  maskBody(mask, pose, tuck, style.rider, opts.time ?? 0);
  if (flipping) mask.squashY(flipScale(pose.pitch));
  mask.stamp(fb, opts.palette ?? MONO);
}

/** The board: tail on the track head, solid capsule, outlined when it points steeply downhill. */
function maskBoard(set: Mask, pose: Readonly<RiderPose>, board: number): void {
  const { x: rx, y: ry, nx, ny, ang, steep } = pose;
  const n: Pt = [nx, ny];
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
    if (board === 1 && u % 4 < 2) toggle(u);
    if (board === 2 && u % 4 === 1) toggle(u);
  }
  if (board === 3) {
    // twin tip: notch both ends
    set.delete(rx + n[0] * 0.5, ry + n[1] * 0.5);
    set.delete(rx + n[0] * (BLEN - 0.5), ry + n[1] * (BLEN - 0.5));
  }
}

/** The joints of the rider for one pose, in screen pixels. */
interface Skeleton {
  n: Pt;
  /** +1 heading right, -1 heading left. */
  mv: 1 | -1;
  /** Back to the camera, on the heels: heading right riding regular, heading left riding switch. */
  heel: boolean;
  /** Straight downhill the rider is seen almost head on. */
  rear: boolean;
  hip: Pt;
  sh: Pt;
  head: Pt;
  /** Feet on the board and the knees above them: front then back. */
  ff: Pt;
  fb: Pt;
  kf: Pt;
  kb: Pt;
}

/** Legs are solved to land exactly on the board. */
function solveSkeleton(pose: Readonly<RiderPose>, tuck: number): Skeleton {
  const { x: rx, y: ry, nx, ny, face: mv, up, steep } = pose;
  const n: Pt = [nx, ny];
  const along = (u: number): Pt => [rx + n[0] * u, ry + n[1] * u];
  const M = along(11.5 * SC);
  const FF = along(17 * SC);
  const FB = along(6 * SC);
  const crouch = tuck * 0.55;
  const stand = (4 + 3 * up) * SC * (1 - crouch);
  // Toe side (regular heading left): chest to the camera, leaning into the turn, goggles visible.
  // Heel side (regular heading right): back to the camera, leaning back over the heels with hips out.
  // Riding switch the other foot leads, so the same heading shows the other side of him.
  const heel = heelSide(pose);
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
  const fb: Pt = [FB[0], FB[1] - 1];
  const rear = steep && pose.ang > 74;
  return { n, mv, heel, rear, hip, sh, head, ff, fb, kf: knee(ff), kb: knee(fb) };
}

function maskLegsAndTorso(set: Mask, { hip, sh, ff, fb, kf, kb }: Readonly<Skeleton>): void {
  set.line(hip[0], hip[1], kf[0], kf[1], 2);
  set.line(kf[0], kf[1], ff[0], ff[1], 2);
  set.line(hip[0], hip[1], kb[0], kb[1], 2);
  set.line(kb[0], kb[1], fb[0], fb[1], 2);
  set.line(hip[0], hip[1], sh[0], sh[1], 3); // torso
}

function maskArms(set: Mask, b: Readonly<Skeleton>, tuck: number): void {
  const { n, heel, hip, sh, kf, kb } = b;
  if (b.rear) {
    // Seen head on: broad shoulders, arms hanging to the sides.
    set.line(sh[0] - 4, sh[1], sh[0] + 4, sh[1], 2);
    set.line(sh[0] - 4, sh[1], hip[0] - 4, hip[1] - 1 + tuck * 3, 1);
    set.line(sh[0] + 4, sh[1], hip[0] + 4, hip[1] - 1 + tuck * 3, 1);
    set.line(hip[0] - 2, hip[1], hip[0] + 2, hip[1], 2);
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
}

function maskHelmet(set: Mask, { head, rear }: Readonly<Skeleton>): void {
  for (let j = 0; j < 3; j++) for (let i = -2; i <= 1; i++) set.add(head[0] + i, head[1] - 1 + j);
  if (rear) {
    set.add(head[0] + 2, head[1]);
    set.add(head[0] + 2, head[1] + 1);
    set.add(head[0] - 3, head[1]);
    set.add(head[0] - 3, head[1] + 1);
  }
}

/** Cut the face: goggles from the front, a vent slot from behind. */
function cutFace(set: Mask, { head, heel, mv }: Readonly<Skeleton>): void {
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
}

/** The rider, in paint order: the headgear goes on before the face is cut. */
function maskBody(
  set: Mask,
  pose: Readonly<RiderPose>,
  tuck: number,
  rider: number,
  time: number,
): void {
  const b = solveSkeleton(pose, tuck);
  maskLegsAndTorso(set, b);
  maskArms(set, b, tuck);
  maskHelmet(set, b);
  headgear(set, rider, b.head, b.mv, time);
  cutFace(set, b);
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

/**
 * A wipeout: the rider tumbles through the air, lands, and lies in the snow. Drawn as a small
 * stick figure rotated about its middle, in the same one-colour style as the riding pose.
 * `t` is seconds since the crash, `face` the side the rider was heading to. A skier tumbles with
 * crossed skis and his poles.
 */
export function drawWipeout(
  fb: Framebuffer,
  x: number,
  y: number,
  t: number,
  face: 1 | -1,
  skis = false,
  pal: Readonly<Palette> = MONO,
): void {
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
  set.paint = 2;
  if (skis) {
    // Two skis crossed under the boots, and the poles still in the hands.
    seg([-9, 1], [9, -1], 1);
    seg([-9, -2], [9, 0], 1);
  } else {
    seg([-9, 0], [9, 0], 2); // board
  }
  set.paint = 1;
  seg([-3, -1], [0, -4], 1);
  seg([3, -1], [0, -4], 1); // legs
  seg([0, -4], [0, -11], 3); // torso
  seg([0, -10], [-4, -6], 1);
  seg([0, -10], [4, -13], 1); // flailing arms
  if (skis) {
    seg([-4, -6], [-10, -2], 1);
    seg([4, -13], [11, -15], 1); // poles
  }
  for (let j = 0; j < 3; j += 0.5) {
    for (let i = -2; i <= 1.5; i += 0.5) {
      const q = tx(i, -14 + j);
      set.add(q[0], q[1]);
    }
  }
  set.stamp(fb, pal);
}

// ---------------------------------------------------------------------------------------------
// The skier. Kept apart from the snowboarder above: it shares the mask, the helmet, headgear and
// face cut, and the flip squash, nothing else. The skis start on the track head (the tail
// position the sim records) and point along the heading, like the board.
// ---------------------------------------------------------------------------------------------

/** Skis are as long as the board, this far apart centre to centre, with the boots this far up from the tails. */
const SKI_LEN = BOARD_LEN;
const SKI_GAP = 4;
const BOOT = 9;
/** Share of their length the skis lose pointing straight down the hill. */
const SKI_FORESHORTEN = 0.3;

/**
 * Skis pointing straight down or up the hill run along the line of sight, so they are drawn shorter than across the
 * slope. Without it, two long straight lines under the boots read as the skier's legs.
 */
function reach(ny: number): number {
  return 1 - SKI_FORESHORTEN * ny ** 4;
}

/** The joints of the skier for one pose, in screen pixels. Pairs are the two sides, near one first. */
interface SkierSkeleton {
  n: Pt;
  /** Across the skis, from the far ski to the near one. */
  p: Pt;
  mv: 1 | -1;
  /** Seen from the side (going across the slope), from behind (downhill) or from the front (uphill, mid spin). */
  view: 'side' | 'back' | 'front';
  hip: Pt;
  sh: Pt;
  head: Pt;
  feet: readonly [Pt, Pt];
  knees: readonly [Pt, Pt];
  elbows: readonly [Pt, Pt];
  hands: readonly [Pt, Pt];
  /** Where each pole ends: in the snow, or pointing back past the skier in a tuck. */
  tips: readonly [Pt, Pt];
  /** Shoulders square to the camera: from behind and from the front. */
  square: boolean;
  /** From the side the far arm and pole hide behind the body. */
  farArm: boolean;
}

function drawSkier(
  fb: Framebuffer,
  pose: Readonly<RiderPose>,
  style: Readonly<RiderStyle>,
  time: number,
  brake: number,
  pal: Readonly<Palette>,
): void {
  const tuck = Math.max(pose.tuck, flipTuck(pose.pitch));
  const flipping = Math.abs(Math.sin((pose.pitch * Math.PI) / 360)) > 0.004;
  mask.reset(pose.x, pose.y - 10);
  const b = solveSkier(pose, tuck, brake);
  mask.paint = 2;
  maskSkis(mask, pose, b, style.board);
  mask.paint = 1;
  maskSkierBody(mask, b);
  // The helmet and face cut take the snowboarder's skeleton: from behind it is the back of the head.
  const head: Skeleton = {
    n: b.n,
    mv: b.mv,
    heel: b.view === 'back',
    rear: b.view !== 'side',
    hip: b.hip,
    sh: b.sh,
    head: b.head,
    ff: b.feet[0],
    fb: b.feet[1],
    kf: b.knees[0],
    kb: b.knees[1],
  };
  maskHelmet(mask, head);
  headgear(mask, style.rider, b.head, b.mv, time);
  cutFace(mask, head);
  if (flipping) mask.squashY(flipScale(pose.pitch));
  mask.stamp(fb, pal);
}

function solveSkier(pose: Readonly<RiderPose>, tuck: number, brake: number): SkierSkeleton {
  const { x: rx, y: ry, nx, ny, face } = pose;
  const n: Pt = [nx, ny];
  // Riding switch a skier goes backwards: the body faces up the hill, the way the skis came from.
  const regular = pose.stance === 1;
  const mv: 1 | -1 = regular ? face : face === 1 ? -1 : 1;
  // The near ski is the one lower on the screen.
  const p: Pt = nx >= 0 ? [-ny, nx] : [ny, -nx];
  // The same switch, with the same hysteresis, as the board's solid and outlined looks.
  const view = !pose.steep ? 'side' : ny > 0 === regular ? 'back' : 'front';
  const half = SKI_GAP / 2;
  const boot: Pt = [rx + nx * BOOT * reach(ny), ry + ny * BOOT * reach(ny)];
  const feet: [Pt, Pt] = [
    [boot[0] + p[0] * half, boot[1] + p[1] * half - 1],
    [boot[0] - p[0] * half, boot[1] - p[1] * half - 1],
  ];
  // A stop sinks the hips, like the crouch of a tuck but upright.
  const sink = Math.max(tuck * 0.55, brake * 0.3);
  const stand = 5.5 * SC * (1 - sink);
  if (view === 'side') return solveSkierSide(n, p, mv, boot, feet, stand, tuck, brake);
  // Square on: legs to the two skis, poles out to each side.
  const hip: Pt = [boot[0], boot[1] - stand - 2 * SC];
  const sh: Pt = [hip[0], hip[1] - 6 * SC * (1 - 0.3 * tuck)];
  const head: Pt = [sh[0], sh[1] - 4 * SC];
  // Knees bow out a little, so the legs read apart from the straight skis below them.
  const knee = (f: Pt): Pt => [
    (hip[0] + f[0]) / 2 + Math.sign(f[0] - hip[0]) * 1.2,
    (hip[1] + f[1]) / 2,
  ];
  const ground = Math.max(feet[0][1], feet[1][1]) + 1;
  const arms = squareArms(sh, hip, ground, tuck, feet[0][0] < hip[0] ? -1 : 1);
  return {
    n,
    p,
    mv,
    view,
    hip,
    sh,
    head,
    feet,
    knees: [knee(feet[0]), knee(feet[1])],
    ...arms,
    square: true,
    farArm: true,
  };
}

/**
 * Shoulders square to the camera: elbows out, poles planted wide of the skis, or tucked with the poles under the
 * arms poking out behind. `near` is the side (-1 left, 1 right) of the first of each pair.
 */
function squareArms(
  sh: Pt,
  hip: Pt,
  ground: number,
  tuck: number,
  near: -1 | 1,
): Pick<SkierSkeleton, 'elbows' | 'hands' | 'tips'> {
  const arm = (s: number): { elbow: Pt; hand: Pt; tip: Pt } => {
    if (tuck > 0.45) {
      const elbow: Pt = [sh[0] + s * 3, sh[1] + 2];
      const hand: Pt = [hip[0] + s * 1.5, hip[1]];
      return { elbow, hand, tip: [hip[0] + s * 5, hip[1] - 2] };
    }
    const elbow: Pt = [sh[0] + s * 4, sh[1] + 3];
    const hand: Pt = [sh[0] + s * 5, sh[1] + 5];
    return { elbow, hand, tip: [hand[0] + s * 3, ground] };
  };
  const a = arm(near);
  const c = arm(-near);
  return { elbows: [a.elbow, c.elbow], hands: [a.hand, c.hand], tips: [a.tip, c.tip] };
}

/** Across the slope: knees and shoulders lead the way, hips sit back over the boots. */
function solveSkierSide(
  n: Pt,
  p: Pt,
  mv: 1 | -1,
  boot: Pt,
  feet: readonly [Pt, Pt],
  stand: number,
  tuck: number,
  brake: number,
): SkierSkeleton {
  // A hockey stop: the skis skid across the slope with the body upright over them.
  const lean = brake > 0.5 ? 0.3 : 1.5 + 2.5 * tuck;
  const hip: Pt = [boot[0] - mv * 1.2 * SC, boot[1] - stand - 2 * SC];
  const sh: Pt = [hip[0] + mv * lean * SC, hip[1] - 6 * SC * (1 - 0.3 * tuck)];
  const head: Pt = [sh[0] + mv * (1 + tuck) * SC, sh[1] - 4 * SC];
  const knee = (f: Pt): Pt => [
    (hip[0] + f[0]) / 2 + mv * (2 + 1.5 * tuck) * SC,
    (hip[1] + f[1]) / 2 - 0.5,
  ];
  const ground = Math.max(feet[0][1], feet[1][1]) + 1;
  const knees: [Pt, Pt] = [knee(feet[0]), knee(feet[1])];
  let hands: [Pt, Pt];
  let tips: [Pt, Pt];
  if (tuck > 0.45) {
    // Hands forward by the knees, poles tucked under the arms pointing back.
    const h: Pt = [sh[0] + mv * 2 * SC, sh[1] + 4 * SC];
    hands = [h, [h[0] - mv, h[1] - 1]];
    tips = [
      [h[0] - mv * 9 * SC, h[1] - 1.5 * SC],
      [h[0] - mv * 9 * SC - mv, h[1] - 1.5 * SC - 1],
    ];
  } else {
    // Hands out in front, poles trailing back to the snow.
    const h: Pt = [sh[0] + mv * 3 * SC, sh[1] + 3 * SC];
    hands = [h, [h[0] - mv * 1.5, h[1] - 1]];
    tips = [
      [h[0] - mv * 3 * SC, ground],
      [h[0] - mv * 3 * SC - mv * 1.5, ground - 2],
    ];
  }
  const mid = (h: Pt): Pt => [(sh[0] + h[0]) / 2, (sh[1] + 1 + h[1]) / 2];
  const elbows: [Pt, Pt] = [mid(hands[0]), mid(hands[1])];
  return {
    n,
    p,
    mv,
    view: 'side',
    hip,
    sh,
    head,
    feet,
    knees,
    elbows,
    hands,
    tips,
    square: false,
    farArm: false,
  };
}

/** Two thin skis side by side, tips turned up. The board looks carry over to them. */
function maskSkis(
  set: Mask,
  pose: Readonly<RiderPose>,
  { n, p }: Readonly<SkierSkeleton>,
  board: number,
): void {
  const half = SKI_GAP / 2;
  const curl = 2 * (1 - pose.ang / 110);
  const regular = pose.stance === 1;
  const wide = pose.steep;
  // Seen from behind, the tails hide behind the boots, so the skis start at the feet instead of running up the legs.
  const from = wide ? Math.max(0, BOOT * reach(n[1]) - 1.5) : 0;
  for (const s of [1, -1]) {
    const tx = pose.x + p[0] * half * s;
    const ty = pose.y + p[1] * half * s;
    const len = SKI_LEN * reach(n[1]);
    const out = p[0] * s >= 0 ? 1 : -1;
    for (let u = from; u <= len; u += 0.5) {
      // The tip curls up at the front of the ski: the downhill end, or the uphill end riding switch (backwards).
      const toTip = regular ? len - u : u;
      const rise = Math.max(0, (4 - toTip) / 4) ** 2 * curl;
      const tail = board === 3 ? Math.max(0, (3 - (len - toTip)) / 3) ** 2 * curl : 0;
      const x = tx + n[0] * u;
      const y = ty + n[1] * u - rise - tail;
      set.add(x, y);
      // Seen from behind the skis show their whole width, so they read as planks rather than more legs.
      if (wide) set.add(x + out, y);
    }
    // Stripes and dots go along the outside edge: cut out of a wide ski, added beside a thin one (the near ski only,
    // as the far one runs under the body).
    if ((board !== 1 && board !== 2) || (!wide && s < 0)) continue;
    for (let u = Math.max(3, Math.ceil(from)); u < len - 2; u++) {
      // From the side a stripe is a solid band along the middle of the ski: dashes there look like jaggies.
      if (board === 1 ? wide && u % 4 >= 2 : u % 4 !== 1) continue;
      if (board === 1 && !wide && (u < 6 || u > len - 6)) continue;
      const x = tx + n[0] * u;
      const y = ty + n[1] * u;
      if (wide) set.delete(x + out, y);
      else set.add(x + p[0] * s, y + p[1] * s);
    }
  }
}

function maskSkierBody(set: Mask, b: Readonly<SkierSkeleton>): void {
  const { hip, sh, feet, knees, hands, tips } = b;
  for (let k = 1; k >= 0; k--) {
    const f = feet[k];
    const kn = knees[k];
    if (!f || !kn) continue;
    // Square on, two thin legs bowing out keep a gap between them, so they read apart from the skis.
    const thin = b.square && b.view !== 'side';
    const th = thin ? 1 : 2;
    const top = thin ? hip[0] + Math.sign(f[0] - hip[0]) : hip[0];
    set.line(top, hip[1], kn[0], kn[1], th);
    set.line(kn[0], kn[1], f[0], f[1], th);
  }
  set.line(hip[0], hip[1], sh[0], sh[1], 3); // torso
  if (b.square) set.line(sh[0] - 3, sh[1], sh[0] + 3, sh[1], 2); // shoulders
  for (let k = b.farArm ? 1 : 0; k >= 0; k--) {
    const e = b.elbows[k];
    const h = hands[k];
    const t = tips[k];
    if (!e || !h || !t) continue;
    const from: Pt = b.square ? [sh[0] + Math.sign(h[0] - sh[0]) * 3, sh[1]] : [sh[0], sh[1] + 1];
    set.line(from[0], from[1], e[0], e[1], 1);
    set.line(e[0], e[1], h[0], h[1], 1); // arm
    // Poles are the colour of the skis in colour mode, so they read apart from the arms.
    set.paint = 2;
    set.line(h[0], h[1], t[0], t[1], 1); // pole
    // The basket, a nub just above the tip on the outside, is what tells a pole from an arm.
    const out = t[0] >= h[0] ? 1 : -1;
    const up = t[1] >= h[1] ? -2 : 2;
    set.add(t[0] + out, t[1] + up);
    set.paint = 1;
  }
}
