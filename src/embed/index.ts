/**
 * Powline embed: the game's real rider, shadow, carved track and powder, drawn into a transparent RGBA surface so
 * another page (Eli's personal site) can composite them over its own content. Everything is a pure function of its
 * inputs: no DOM, no clock, no unseeded randomness, so a scroll-driven scene can scrub forwards and backwards.
 *
 * Every public type is declared in this file, so the declaration build emits one self-contained .d.ts.
 */
import { BOARD_LEN } from '../core/config';
import { boardPose } from '../sim/pose';
import { Framebuffer, PALETTE } from '../render/framebuffer';
import { drawAirShadow, drawRider as drawRiderSprite } from '../render/riderSprite';
import { TrackPainter } from '../render/track';
import { burstDuration, burstRng, drawBurst, type Burst } from './flecks';

/** Board pose in art pixels of the target surface. */
export interface EmbedPose {
  /** Board centre on the snow. */
  x: number;
  y: number;
  /** Radians. 0 points the board straight down the page (+y, the fall line), positive turns it toward +x. */
  heading: number;
  /**
   * -1..1 carve lean: negative heelside, positive toeside, 0 flat. As in the game, a board heading toward +x is
   * ridden heelside (back to the viewer) and toward -x toeside (chest to the viewer), so the stance follows the
   * heading; the edge picks the stance only near the fall line, and its size deepens the lean.
   */
  edge: number;
  /** Art px above the snow, 0 when grounded. The rider is drawn lifted by `air`, the shadow stays at (x, y). */
  air: number;
  /** Flip rotation in radians, 0 for none. Positive is the game's backflip (the head swings back first). */
  pitch: number;
  /** Extra yaw in radians for spins, 0 for none. It turns the board about its centre the same way as `heading`. */
  spin: number;
  /** 0..1 knee compression, for the pop and the landing absorb. */
  crouch: number;
}

/** RGBA pixels, row by row. Alpha is 0 wherever nothing is drawn. */
export interface Surface {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** The game's unlockable looks. */
export interface EmbedRiderStyle {
  /** 0 classic, 1 stripe, 2 dots, 3 twin tip. */
  board?: number;
  /** 0 helmet, 1 beanie, 2 scarf, 3 ears. */
  rider?: number;
  /** Seconds, only for the fluttering scarf. Pass the scroll-driven time for a scarf that moves. */
  time?: number;
}

/** One board position along the path, for `EmbedTrack.add`. */
export interface EmbedTrackPoint {
  /** Board centre, the same point as `EmbedPose.x` and `y`. */
  x: number;
  y: number;
  heading: number;
  /** Accepted for symmetry with `EmbedPose`: the track reads its turns from the path itself, as the game does. */
  edge: number;
  /** Above 0 the board is off the snow, so the track breaks there and starts again where it lands. */
  air: number;
  /**
   * Optional, 0..1: how far the board is slid sideways (the game's side slip, when it brakes). Above 0 the track
   * widens into one solid band from the tail to the nose, shaded inside. Default 0.
   */
  slide?: number;
}

/** Board length in art px: the rider is drawn about this tall and the board this long. */
export const EMBED_BOARD_LEN: number = BOARD_LEN;

/** Seconds after which `drawSpray` and `drawLanding` draw nothing. */
export const SPRAY_DURATION: number = burstDuration(sprayBurst(0, 0, 0, 1));
export const LANDING_DURATION: number = burstDuration(landingBurst(0, 0));

/** CSS colours matching the game: the line and rider, the UI accent, and the two greys of the track shadow. */
export const EMBED_PALETTE: { white: string; yellow: string; grey: string; softGrey: string } = {
  white: css(PALETTE.white),
  yellow: css(PALETTE.yellow),
  grey: css(PALETTE.grey),
  softGrey: css(PALETTE.softGrey),
};

/** A transparent surface. */
export function createSurface(width: number, height: number): Surface {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`createSurface: expected positive whole sizes, got ${width}x${height}`);
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Back to fully transparent. */
export function clearSurface(s: Surface): void {
  s.data.fill(0);
}

/**
 * The game's rider and board (`render/riderSprite.ts`), with the game's checker shadow on the snow under it while
 * `air` > 0. Like the game it has a one pixel black outline, so it reads over the track and anything behind it.
 */
export function drawRider(s: Surface, pose: EmbedPose, style: EmbedRiderStyle = {}): void {
  if (!finite(pose.x, pose.y, pose.heading, pose.spin, pose.pitch)) return;
  const fb = target(s);
  const air = Math.max(0, finiteOr(pose.air, 0));
  const edge = clamp(finiteOr(pose.edge, 0), -1, 1);
  const yaw = pose.heading + pose.spin;
  const nx = Math.sin(yaw);
  const ny = Math.cos(yaw);
  // Toward +x is heelside, as in the game. Within its no-flicker band of the fall line the edge decides.
  const face = Math.abs(nx) > 0.05 ? (nx > 0 ? 1 : -1) : edge < 0 ? 1 : -1;
  const up = Math.min(1, Math.max(Math.abs(nx) * 2.2, Math.abs(edge)));
  const cx = Math.round(pose.x);
  const cy = Math.round(pose.y);
  if (air > 0) drawAirShadow(fb, cx, cy, air);
  const crouch = clamp(finiteOr(pose.crouch, 0), 0, 1);
  const pitch = (pose.pitch * 180) / Math.PI;
  const rp = boardPose(cx, Math.round(pose.y - air), nx, ny, face, crouch, pitch, up);
  drawRiderSprite(fb, rp, {
    style: { board: look(style.board), rider: look(style.rider) },
    time: finiteOr(style.time ?? 0, 0),
  });
}

/**
 * The game's track (`render/track.ts`): one clean line from the board's tail that swells in turns, a soft grey
 * shadow on the sun side, a little powder outside the hardest turns, and a break over every jump. Feed it the board
 * positions along the path in order, then draw. For a scrubbed scene, `reset` and replay the path up to the current
 * point each frame: the track only depends on the points given.
 */
export class EmbedTrack {
  private readonly painter = new TrackPainter();
  private runs: Run[] = [];
  private run: Run | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastNx = 0;
  private lastNy = 0;

  reset(): void {
    this.runs = [];
    this.run = null;
  }

  add(p: EmbedTrackPoint): void {
    if (!finite(p.x, p.y, p.heading)) return;
    if (finiteOr(p.air, 0) > 0) {
      this.run = null;
      return;
    }
    // The game records the board's tail, and a slide as the vector from the tail to the nose.
    const dx = Math.sin(p.heading);
    const dy = Math.cos(p.heading);
    const tx = p.x - (dx * BOARD_LEN) / 2;
    const ty = p.y - (dy * BOARD_LEN) / 2;
    const slide = clamp(finiteOr(p.slide ?? 0, 0), 0, 1);
    // The game only draws a slip once the brake is past 0.15.
    const nx = slide > SLIDE_FROM ? dx * slide : 0;
    const ny = slide > SLIDE_FROM ? dy * slide : 0;
    const run = this.run;
    if (!run) {
      const fresh = new Run();
      fresh.push(tx, ty, nx, ny);
      this.runs.push(fresh);
      this.run = fresh;
    } else {
      // Walk the segment in small steps and keep a point every SPACING px of travel, the way the sim records one
      // at each fixed step, so the track looks the same however finely the caller samples the path.
      const len = Math.hypot(tx - this.lastX, ty - this.lastY);
      const steps = Math.max(1, Math.ceil(len / SUB_STEP));
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const x = this.lastX + (tx - this.lastX) * f;
        const y = this.lastY + (ty - this.lastY) * f;
        if (Math.hypot(x - run.lastX(), y - run.lastY()) < SPACING) continue;
        run.push(x, y, this.lastNx + (nx - this.lastNx) * f, this.lastNy + (ny - this.lastNy) * f);
      }
    }
    this.lastX = tx;
    this.lastY = ty;
    this.lastNx = nx;
    this.lastNy = ny;
  }

  draw(s: Surface): void {
    const fb = target(s);
    for (const run of this.runs) if (run.count >= 2) this.painter.draw(fb, run, 0);
  }
}

/**
 * Powder thrown off the board in a slash, `age` seconds after it started: flecks fly up off the whole edge and out
 * to the outside of the turn, come down, and a few stay on the snow for a moment. Draws nothing once `age` reaches
 * SPRAY_DURATION. `at` is the board centre, `edge` picks the side (toeside throws toward +x when heading straight
 * down, heelside toward -x) and its size how hard the slash is.
 */
export function drawSpray(
  s: Surface,
  at: { x: number; y: number },
  heading: number,
  edge: number,
  age: number,
  seed = 0,
): void {
  if (!finite(at.x, at.y, heading, age)) return;
  const burst = sprayBurst(at.x, at.y, heading, clamp(finiteOr(edge, 0), -1, 1));
  drawBurst(target(s), burst, age, burstRng(seed, 0x51a5));
}

/** A puff of powder kicked out from under the board as it lands, `age` seconds after touchdown. */
export function drawLanding(s: Surface, at: { x: number; y: number }, age: number, seed = 0): void {
  if (!finite(at.x, at.y, age)) return;
  drawBurst(target(s), landingBurst(at.x, at.y), age, burstRng(seed, 0x1a2d));
}

/** Points the track keeps per px of travel: the sim's own spacing, found by walking in small steps. */
const SPACING = 1.5;
const SUB_STEP = 0.5;
const SLIDE_FROM = 0.15;

function sprayBurst(x: number, y: number, heading: number, edge: number): Burst {
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const side = edge < 0 ? -1 : 1;
  const power = 0.35 + 0.65 * Math.abs(edge);
  return {
    x: x + dy * side * 2,
    y: y - dx * side * 2,
    alongX: dx,
    alongY: dy,
    length: BOARD_LEN * 0.8,
    count: Math.round(26 + 34 * power),
    emit: 0.22,
    // The brake spray's jet, from `state/effects.ts`.
    up: 70 + 80 * power,
    spread: 22 + 8 * power,
    life: 0.75,
    throwX: dy * side,
    throwY: -dx * side,
    throwSpeed: 50 + 70 * power,
    // Without the rider's own speed the flecks would only drift up the page, so they keep some of it.
    carryX: dx * 90,
    carryY: dy * 90,
    linger: 0.6,
  };
}

function landingBurst(x: number, y: number): Burst {
  return {
    x,
    y,
    alongX: 1,
    alongY: 0,
    length: BOARD_LEN,
    count: 22,
    emit: 0.05,
    up: 45,
    spread: 48,
    life: 0.45,
    throwX: 0,
    throwY: 1,
    throwSpeed: 30,
    carryX: 0,
    carryY: 20,
    linger: 0.45,
  };
}

/** One unbroken stretch of track: the shape `TrackPainter` reads from the sim's trail. */
class Run {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly nxs: number[] = [];
  private readonly nys: number[] = [];

  get count(): number {
    return this.xs.length;
  }

  push(x: number, y: number, nx: number, ny: number): void {
    this.xs.push(x);
    this.ys.push(y);
    this.nxs.push(nx);
    this.nys.push(ny);
  }

  x(i: number): number {
    return this.xs[i] ?? 0;
  }

  y(i: number): number {
    return this.ys[i] ?? 0;
  }

  nx(i: number): number {
    return this.nxs[i] ?? 0;
  }

  ny(i: number): number {
    return this.nys[i] ?? 0;
  }

  lastX(): number {
    return this.xs[this.xs.length - 1] ?? NaN;
  }

  lastY(): number {
    return this.ys[this.ys.length - 1] ?? NaN;
  }
}

function target(s: Surface): Framebuffer {
  return new Framebuffer(s.width, s.height, s.data);
}

function look(v: number | undefined): number {
  return v === undefined || !Number.isFinite(v) ? 0 : clamp(Math.floor(v), 0, 3);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finite(...vs: number[]): boolean {
  return vs.every(Number.isFinite);
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function css(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
