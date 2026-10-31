import { BOARD_LEN, H } from '../core/config';
import { hash2 } from '../core/rng';
import type { TrailView } from '../state/view';
import { GREY, SOFT_GREY, WHITE, type Framebuffer } from './framebuffer';

/** Past this gap between recorded points the rider was in the air, so the track breaks instead of joining up. */
const GAP = 6;
/** Points averaged on each side when smoothing the recorded path. */
const SMOOTH = 6;
/** Points on each side used to measure the direction of travel, and how far apart to compare two directions. */
const TANGENT_SPAN = 3;
const BEND_SPAN = 7;
/** A change of direction this large counts as a full turn. */
const FULL_BEND = 0.5;
/** Tight key-press turns stop deepening here, so they stay as calm as a gentle carve. */
const MAX_DEPTH = 0.6;
/** Which way shadows fall: down and to the right, like the shadows of the trees. */
const SUN_X = 0.89;
const SUN_Y = 0.45;
/** The line's width on a straight, and how much it gains in the hardest turn. */
const BASE_WIDTH = 2;
const SWELL = 2;
/** How far the shadow reaches from the line in the hardest turn. */
const SHADOW = 2.5;
/** Powder only shows in the hardest turns, and only a light dusting. */
const POWDER_MIN_DEPTH = 0.45;
const POWDER_DENSITY = 0.12;
const POWDER_GRAINS = 3;
/** Points between the two stretches of already travelled path compared to judge a turn for powder. */
const POWDER_SPAN = 7;
/**
 * New points keep changing the smoothing and bend of the points before them. Over this many points behind the
 * board, turn effects fade in, so the line grows out of the board smoothly instead of shimmering. Past it the
 * track never changes again.
 */
const SETTLE = 18;
/** Inside a side slip: how far the shadow reaches in from the band's edge, at most. */
const BAND_SHADOW = 3;
const BAND_SHADOW_SHARE = 0.4;
/** The band has to be this wide before it has a shadow, so a barely open slide stays as clean as the line. */
const BAND_SHADOW_FROM = 4;
/** Sub-steps along each recorded segment, close enough that no row or column is skipped. */
const ALONG = [0, 0.34, 0.67];

/**
 * Draws the board's track as a real one looks: a thin unbroken line that swells gently through a turn, with a
 * soft shadow on the side nearest the sun and a little powder outside the hardest turns. Once settled, it stays put.
 */
export class TrackPainter {
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private tx = new Float64Array(0);
  private ty = new Float64Array(0);
  private bend = new Float64Array(0);
  private tailX = new Float64Array(0);
  private tailY = new Float64Array(0);
  private nose = false;
  private start = 0;
  private end = 0;

  draw(fb: Framebuffer, t: TrailView, cam: number): void {
    this.reserve(t.count);
    let start = 0;
    for (let i = 1; i <= t.count; i++) {
      if (i < t.count && Math.hypot(t.x(i) - t.x(i - 1), t.y(i) - t.y(i - 1)) <= GAP) continue;
      if (i - start >= 2) this.drawRun(fb, t, start, i - 1, cam);
      start = i;
    }
    this.drawSkid(fb, t, cam);
  }

  private reserve(n: number): void {
    if (this.x.length >= n) return;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.bend = new Float64Array(n);
    this.tailX = new Float64Array(n);
    this.tailY = new Float64Array(n);
  }

  /** Paint order matters: powder and shadow first, so the line always sits on top of them. */
  private drawRun(fb: Framebuffer, t: TrailView, a: number, b: number, cam: number): void {
    this.prepare(t, a, b);
    this.start = a;
    this.end = b;
    for (let i = a; i <= b; i++) this.drawPowder(fb, t, i, cam);
    for (let i = a + 1; i <= b; i++) this.drawShadow(fb, i, cam);
    for (let i = a + 1; i <= b; i++) this.drawLine(fb, i, cam);
  }

  /** Smooth one unbroken piece of the trail, keeping its ends anchored, and work out how it bends. */
  private prepare(t: TrailView, a: number, b: number): void {
    for (let i = a; i <= b; i++) {
      const w = Math.min(SMOOTH, i - a, b - i);
      let sx = 0;
      let sy = 0;
      for (let j = i - w; j <= i + w; j++) {
        sx += this.pointX(t, j);
        sy += this.pointY(t, j);
      }
      this.x[i] = sx / (2 * w + 1);
      this.y[i] = sy / (2 * w + 1);
    }
    for (let i = a; i <= b; i++) {
      const from = Math.max(a, i - TANGENT_SPAN);
      const to = Math.min(b, i + TANGENT_SPAN);
      const dx = (this.x[to] ?? 0) - (this.x[from] ?? 0);
      const dy = (this.y[to] ?? 0) - (this.y[from] ?? 0);
      const len = Math.hypot(dx, dy) || 1;
      this.tx[i] = dx / len;
      this.ty[i] = dy / len;
    }
    for (let i = a; i <= b; i++) {
      const p = Math.max(a, i - BEND_SPAN);
      const q = Math.min(b, i + BEND_SPAN);
      this.bend[i] = (this.tx[p] ?? 0) * (this.ty[q] ?? 0) - (this.ty[p] ?? 0) * (this.tx[q] ?? 0);
    }
  }

  /** How hard the turn is at a point, 0 to MAX_DEPTH, faded in over the points that have not settled yet. */
  private depth(i: number): number {
    // Also fades in after a landing, so the line never starts at full width.
    const settled = Math.min(1, (this.end - i) / SETTLE, (i - this.start) / SETTLE);
    return Math.min(MAX_DEPTH, Math.abs(this.bend[i] ?? 0) / FULL_BEND) * settled;
  }

  /** How squarely the track wall at a point runs across the sun, 0 to 1. */
  private facing(i: number): number {
    return Math.abs((this.ty[i] ?? 0) * SUN_X - (this.tx[i] ?? 0) * SUN_Y);
  }

  private width(i: number): number {
    return BASE_WIDTH + (SWELL * this.depth(i)) / MAX_DEPTH;
  }

  private drawLine(fb: Framebuffer, i: number, cam: number): void {
    const half = this.width(i - 1) / 2;
    this.span(fb, i, cam, -half, half, WHITE);
  }

  /**
   * The track is cut into the snow, so its wall nearest the sun casts the shadow, just as a tree's shadow falls to the
   * right. It grows out from under the line as a turn deepens.
   */
  private drawShadow(fb: Framebuffer, i: number, cam: number): void {
    const reach = (SHADOW * this.depth(i - 1) * this.facing(i - 1)) / MAX_DEPTH;
    if (reach < 0.5) return;
    const half = this.width(i - 1) / 2;
    const sunSide = (this.ty[i - 1] ?? 0) * SUN_X - (this.tx[i - 1] ?? 0) * SUN_Y < 0;
    const steep = Math.abs(this.ty[i - 1] ?? 0) >= Math.abs(this.tx[i - 1] ?? 0);
    // Spans run along x on a steep stretch and along y on a flat one, so turn the side into that axis.
    const along = steep ? (this.ty[i - 1] ?? 0) : -(this.tx[i - 1] ?? 0);
    const positive = along >= 0 === sunSide;
    if (positive) this.span(fb, i, cam, half - 1, half + reach, GREY);
    else this.span(fb, i, cam, -half - reach, -half + 1, GREY);
  }

  /**
   * Fill the segment ending at point i between two signed offsets from the centre, always along whole rows on a
   * steep stretch and whole columns on a flat one. Rounding only the two ends gives clean, even edges.
   */
  private span(
    fb: Framebuffer,
    i: number,
    cam: number,
    lo: number,
    hi: number,
    color: number,
  ): void {
    const ax = this.x[i - 1] ?? 0;
    const ay = this.y[i - 1] ?? 0;
    const bx = this.x[i] ?? 0;
    const by = this.y[i] ?? 0;
    if (Math.round(by) - cam < -8 || Math.round(ay) - cam > H + 8) return;
    const steep = Math.abs(this.ty[i - 1] ?? 0) >= Math.abs(this.tx[i - 1] ?? 0);
    for (const u of ALONG) {
      const x = ax + (bx - ax) * u;
      const y = ay + (by - ay) * u;
      const c = steep ? x : y;
      const from = Math.round(c + lo);
      const to = Math.max(from, Math.round(c + hi) - 1);
      for (let d = from; d <= to; d++) {
        if (steep) fb.put(d, Math.round(y) - cam, color);
        else fb.put(Math.round(x), d - cam, color);
      }
    }
  }

  /**
   * Each grain is thrown from the board: it starts under the line and slides out to where it lands as the rider
   * moves on, then stays there. Whether it exists and where it lands come only from recorded board positions up to
   * that point, which never change, so it is decided the moment the board passes and cannot pop in or flicker.
   */
  private drawPowder(fb: Framebuffer, t: TrailView, i: number, cam: number): void {
    const p = Math.max(this.start, i - POWDER_SPAN);
    const q = Math.max(this.start, i - 2 * POWDER_SPAN);
    const ax = t.x(p) - t.x(q);
    const ay = t.y(p) - t.y(q);
    const bx = t.x(i) - t.x(p);
    const by = t.y(i) - t.y(p);
    const bend = (ax * by - ay * bx) / ((Math.hypot(ax, ay) || 1) * (Math.hypot(bx, by) || 1));
    const depth = Math.min(MAX_DEPTH, Math.abs(bend) / FULL_BEND);
    if (depth < POWDER_MIN_DEPTH) return;
    const ix = Math.round(t.x(i));
    const iy = Math.round(t.y(i));
    const flight = Math.min(1, (this.end - i) / SETTLE);
    const thrown = 1 - (1 - flight) * (1 - flight);
    const sign = bend >= 0 ? -1 : 1;
    const dx = (this.ty[i] ?? 0) * sign;
    const dy = -(this.tx[i] ?? 0) * sign;
    for (let grain = 0; grain < POWDER_GRAINS; grain++) {
      if (hash2(ix + grain * 31, iy) >= POWDER_DENSITY) continue;
      const lands = BASE_WIDTH / 2 + SWELL + 2 + hash2(iy, ix + grain * 17) * 4 * depth;
      const x = Math.round((this.x[i] ?? 0) + dx * lands * thrown);
      const y = Math.round((this.y[i] ?? 0) + dy * lands * thrown);
      if (y - cam >= -8 && y - cam <= H + 8) fb.put(x, y - cam);
    }
  }

  /**
   * A sideways board scrapes the snow from tail to nose, so the track widens into one solid band, shaded on the
   * side nearest the sun, for as long as the slide lasts. It opens out of the line and closes back up smoothly.
   */
  private drawSkid(fb: Framebuffer, t: TrailView, cam: number): void {
    let i = 0;
    while (i < t.count) {
      if (t.nx(i) === 0 && t.ny(i) === 0) {
        i++;
        continue;
      }
      let last = i;
      while (last + 1 < t.count && (t.nx(last + 1) !== 0 || t.ny(last + 1) !== 0)) {
        if (!this.joined(t, last)) break;
        last++;
      }
      const a = i > 0 && this.joined(t, i - 1) ? i - 1 : i;
      const b = last + 1 < t.count && this.joined(t, last) ? last + 1 : last;
      if (b - a >= 2) this.drawBand(fb, t, a, b, cam);
      i = last + 1;
    }
  }

  /** Fill between the smoothed tail and nose paths, finishing with the nose edge in the line's own stroke. */
  private drawBand(fb: Framebuffer, t: TrailView, a: number, b: number, cam: number): void {
    let first = a;
    while (first > 0 && this.joined(t, first - 1)) first--;
    let final = b;
    while (final + 1 < t.count && this.joined(t, final)) final++;
    this.prepare(t, first, final);
    this.tailX.set(this.x);
    this.tailY.set(this.y);
    this.nose = true;
    this.prepare(t, a, b);
    this.nose = false;
    this.start = a;
    this.end = b;
    for (let k = a + 1; k <= b; k++) {
      this.drawLine(fb, k, cam);
      this.fillBand(fb, k, cam);
    }
  }

  /** Fill the patch of snow scraped between two neighbouring recorded points, leaving no holes. */
  private fillBand(fb: Framebuffer, k: number, cam: number): void {
    const tx0 = this.tailX[k - 1] ?? 0;
    const ty0 = this.tailY[k - 1] ?? 0;
    const tx1 = this.tailX[k] ?? 0;
    const ty1 = this.tailY[k] ?? 0;
    const nx0 = this.x[k - 1] ?? 0;
    const ny0 = this.y[k - 1] ?? 0;
    const nx1 = this.x[k] ?? 0;
    const ny1 = this.y[k] ?? 0;
    if (Math.round(Math.max(ty0, ny0, ty1, ny1)) - cam < -8) return;
    if (Math.round(Math.min(ty0, ny0, ty1, ny1)) - cam > H + 8) return;
    const along = Math.ceil(
      2 * Math.max(Math.hypot(tx1 - tx0, ty1 - ty0), Math.hypot(nx1 - nx0, ny1 - ny0)),
    );
    const across = Math.ceil(
      2 * Math.max(Math.hypot(nx0 - tx0, ny0 - ty0), Math.hypot(nx1 - tx1, ny1 - ty1)),
    );
    for (let u = 0; u <= along; u++) {
      const f = u / Math.max(1, along);
      const fromX = tx0 + (tx1 - tx0) * f;
      const fromY = ty0 + (ty1 - ty0) * f;
      const toX = nx0 + (nx1 - nx0) * f;
      const toY = ny0 + (ny1 - ny0) * f;
      const len = Math.hypot(toX - fromX, toY - fromY);
      const reach = Math.min(BAND_SHADOW, Math.max(0, len - BAND_SHADOW_FROM) * BAND_SHADOW_SHARE);
      // The band is cut into the snow, so its edge nearest the sun casts the shadow across the floor.
      const noseSunward = (toX - fromX) * SUN_X + (toY - fromY) * SUN_Y < 0;
      for (let v = 0; v <= across; v++) {
        const g = v / Math.max(1, across);
        const fromRim = (noseSunward ? 1 - g : g) * len;
        const color = fromRim < reach ? SOFT_GREY : WHITE;
        fb.put(
          Math.round(fromX + (toX - fromX) * g),
          Math.round(fromY + (toY - fromY) * g) - cam,
          color,
        );
      }
    }
  }

  /** Whether the rider stayed on the snow between a point and the next one. */
  private joined(t: TrailView, i: number): boolean {
    return Math.hypot(t.x(i + 1) - t.x(i), t.y(i + 1) - t.y(i)) <= GAP;
  }

  /** A recorded position: the board's tail, or its nose while drawing a skid. */
  private pointX(t: TrailView, i: number): number {
    return this.nose ? t.x(i) + t.nx(i) * BOARD_LEN : t.x(i);
  }

  private pointY(t: TrailView, i: number): number {
    return this.nose ? t.y(i) + t.ny(i) * BOARD_LEN : t.y(i);
  }
}
