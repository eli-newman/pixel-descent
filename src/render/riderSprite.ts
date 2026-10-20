import type { Framebuffer } from './framebuffer';

/** Scale of the rider relative to the original 240x480 art. */
const SC = 0.7;

export interface RiderPose {
  /** Board tail (the track head) in screen pixels. */
  x: number;
  y: number;
  /** Unit vector along the board, pointing downhill. */
  nx: number;
  ny: number;
  /** +1 heading right (heel side, back to camera), -1 heading left (toe side, chest to camera). */
  face: 1 | -1;
  /** 0 on the flats .. 1 fully upright, derived from how sideways the rider points. */
  up: number;
  /** Heading angle in degrees, 90 is straight downhill. */
  ang: number;
  /** Straight-downhill boards are drawn as an outline. */
  steep: boolean;
}

type Pt = readonly [number, number];

/** Integer point set that remembers insertion order. */
class PointSet {
  private readonly m = new Map<number, Pt>();
  private static key(x: number, y: number): number {
    return (x + 4096) * 8192 + (y + 4096);
  }
  add(x: number, y: number): void {
    x = Math.round(x);
    y = Math.round(y);
    const k = PointSet.key(x, y);
    if (!this.m.has(k)) this.m.set(k, [x, y]);
  }
  has(x: number, y: number): boolean {
    return this.m.has(PointSet.key(x, y));
  }
  delete(x: number, y: number): void {
    this.m.delete(PointSet.key(Math.round(x), Math.round(y)));
  }
  list(): Pt[] {
    return [...this.m.values()];
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
}

/** Draw a point set with a one pixel black halo so it reads on top of trees and snow. */
function stamp(fb: Framebuffer, set: PointSet): void {
  const pts = set.list();
  for (const [x, y] of pts) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) if (!set.has(x + i, y + j)) fb.erase(x + i, y + j);
    }
  }
  for (const [x, y] of pts) fb.put(x, y);
}

/**
 * The solved snowboarder from the original art. The heading drives the board, lean and stance
 * continuously, and the legs are solved to land exactly on the board so both feet stay planted.
 */
export function drawRider(fb: Framebuffer, pose: RiderPose): void {
  const { x: rx, y: ry, nx, ny, face: mv, up, ang, steep } = pose;
  const n: Pt = [nx, ny];
  const set = new PointSet();

  // board: tail on the track head, solid capsule, outlined when it points steeply downhill
  {
    const BLEN = Math.round(23 * SC);
    const fill = new Set<string>();
    const hw = steep ? 2.2 : 1.3;
    const y0 = Math.floor(ry) - 4;
    const y1 = Math.ceil(ry + n[1] * BLEN) + 4;
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
        if (Math.hypot(wx - n[0] * u, wy - n[1] * u - curl) <= w) fill.add(`${x},${y}`);
      }
    }
    for (const k of fill) {
      const [x = 0, y = 0] = k.split(',').map(Number);
      const interior =
        fill.has(`${x + 1},${y}`) &&
        fill.has(`${x - 1},${y}`) &&
        fill.has(`${x},${y + 1}`) &&
        fill.has(`${x},${y - 1}`);
      if (!steep || !interior) set.add(x, y);
    }
  }

  // rider: legs are solved to land exactly on the board
  const along = (u: number): Pt => [rx + n[0] * u, ry + n[1] * u];
  const M = along(11.5 * SC);
  const FF = along(17 * SC);
  const FB = along(6 * SC);
  const stand = (4 + 3 * up) * SC; // upright when pointing down, crouched on the flats
  // Toe side (heading left): chest to the camera, leaning into the turn, goggles visible.
  // Heel side (heading right): back to the camera, leaning back over the heels with hips out.
  const heel = mv > 0;
  const lean = (heel ? -2.5 : 3) * up;
  const hip: Pt = [M[0] - n[0] * (heel ? -1.5 : 1.5) * SC, M[1] - stand - 2 * SC];
  const sh: Pt = [hip[0] + mv * lean * SC, hip[1] - 6 * SC];
  const head: Pt = [sh[0] + mv * (heel ? -0.5 : 1.5) * SC, sh[1] - 4 * SC];
  const knee = (f: Pt): Pt => [
    (hip[0] + f[0]) / 2 + n[0] * (heel ? 1.2 : 3.2) * SC,
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
  set.line(
    sh[0],
    sh[1] + 1,
    sh[0] + n[0] * 9 * SC,
    sh[1] + 1 + n[1] * 5 * SC - (heel ? 2 * SC : 0),
    1,
  ); // front arm reaches along the board
  set.line(sh[0], sh[1] + 1, sh[0] - n[0] * 4 * SC, sh[1] + 4 * SC, 1); // back arm
  for (let j = 0; j < 3; j++) for (let i = -2; i <= 1; i++) set.add(head[0] + i, head[1] - 1 + j); // helmet
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
  stamp(fb, set);
}

/** Powder cloud on steep sections and spray flecks flying off the tail, looping with time. */
export function drawSnowKick(fb: Framebuffer, pose: RiderPose, time: number): void {
  const { x: rx, y: ry, nx, ny, ang } = pose;
  const dx = -ny;
  const dy = nx;
  if (ang > 55) {
    for (let k = 0; k < 9; k++) {
      const ph = (time * 1.2 + k / 9) % 1;
      fb.put(
        rx - nx * (2 + ph * 10) + ((k % 3) - 1) * 3 * ph,
        ry - ny * (2 + ph * 10) - ph * 6 * (k % 2 ? 1 : 0.5),
      );
    }
  }
  for (let k = 0; k < 7; k++) {
    const ph = (time * 1.6 + k / 7) % 1;
    const back = 2 + ph * 14;
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
  const set = new PointSet();
  const seg = (a: Pt, b: Pt, th: number): void => {
    const A = tx(a[0], a[1]);
    const B = tx(b[0], b[1]);
    set.line(A[0], A[1], B[0], B[1], th);
  };
  seg([-8, 0], [8, 0], 2); // board
  seg([-3, -1], [0, -4], 1);
  seg([3, -1], [0, -4], 1); // legs
  seg([0, -4], [0, -10], 3); // torso
  seg([0, -9], [-4, -6], 1);
  seg([0, -9], [4, -12], 1); // flailing arms
  for (let j = 0; j < 3; j += 0.5) {
    for (let i = -2; i <= 1.5; i += 0.5) {
      const q = tx(i, -13 + j);
      set.add(q[0], q[1]);
    }
  }
  stamp(fb, set);
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
