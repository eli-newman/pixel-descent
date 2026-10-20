import { H, W } from '../config';
import type { Game } from '../game';
import { hash2 } from '../rng';
import { poseOf } from '../rider';
import type { Sim } from '../sim';
import type { Gate, Obstacle, Patch, Ramp } from '../world/types';
import { BACKDROP_H, buildBackdrop } from './backdrop';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { drawDizzy, drawRider, drawSnowKick, drawWipeout, type RiderStyle } from './riderSprite';
import { getSprite } from './sprites';
import { BOARDS, RIDERS } from '../progress';
import { hudRect, type Rect } from './layout';

function posMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Draws the whole world (not the UI) into a framebuffer from the current game state. */
export class SceneRenderer {
  private readonly backdrop = buildBackdrop();
  /** The framebuffer the UI should draw onto after `render` (differs from `fb` only while zoom-punching). */
  private readonly zoomed: Framebuffer;

  constructor(private readonly fb: Framebuffer) {
    this.zoomed = new Framebuffer(fb.w, fb.h);
  }

  render(g: Game): Framebuffer {
    const fb = this.fb;
    const sim = g.sim;
    fb.clear(OFF);
    const reduced = g.reduced;
    const tuck = g.phase === 'playing' || g.phase === 'paused' ? sim.tuck : 0;
    const shakeK = reduced ? 0 : Math.min(1, g.shake * 4);
    let ox = Math.round(Math.sin(g.animT * 95) * 2 * shakeK);
    let oy = Math.round(Math.cos(g.animT * 80) * 2 * shakeK);
    if (!reduced && tuck > 0.72 && g.phase === 'playing') {
      // A faint rattle at top speed: one pixel jitter on some frames.
      const f = Math.floor(g.animT * 60);
      if (hash2(f, 5) < (tuck - 0.72) * 2.2) {
        ox += hash2(f, 6) < 0.5 ? -1 : 1;
        oy += hash2(f, 7) < 0.5 ? -1 : 1;
      }
    }
    const cam = g.camYi;
    const toY = (y: number): number => y - cam + oy;

    this.drawSky(g, cam, ox, oy);
    this.drawBackdrop(cam, ox, oy);
    this.drawRidges(g, cam);
    this.drawFlecks(cam, ox, oy, hudRect(g.settings.bigHud));
    for (const p of sim.patches) this.drawPatch(p, cam, ox, oy);
    for (const r of sim.ramps) this.drawRamp(r, cam, ox, oy);
    this.drawTrail(sim, cam, ox, oy, tuck);
    for (const gate of sim.gates) this.drawGate(g, gate, cam, ox, oy);
    this.drawPickups(g, cam, ox, oy);

    // Cast shadows first, so every sprite sits on top of every shadow.
    for (const o of sim.obstacles) {
      const sy = toY(o.y);
      if (sy < -4 || sy > H + 60) continue;
      const sp = getSprite(o.kind, o.size, o.variant);
      for (let i = 0; i < sp.shadow.length; i += 2) {
        const dx = sp.shadow[i] ?? 0;
        const dy = sp.shadow[i + 1] ?? 0;
        // dither by world coordinates so the pattern does not shimmer while scrolling
        if ((o.x + dx + o.y + dy) % 2 === 0) fb.put(o.x + dx + ox, sy + dy);
      }
    }

    // Depth sort: obstacles whose base is above the rider's feet are behind the rider.
    const feetY = sim.rider.y + 8;
    const obs = sim.obstacles;
    let i = 0;
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (!o || o.y > feetY) break;
      this.drawObstacle(g, o, cam, ox, oy);
    }
    this.drawGhost(g, cam, ox, oy);
    this.drawRiderAndEffects(g, cam, ox, oy, tuck);
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (o) this.drawObstacle(g, o, cam, ox, oy);
    }

    this.drawParticles(g, cam, ox, oy);
    this.drawAvalanche(g, cam, oy);
    if (!reduced) this.drawWeather(g, cam, tuck, hudRect(g.settings.bigHud));
    return this.zoomPunch(g);
  }

  private drawObstacle(g: Game, o: Obstacle, cam: number, ox: number, oy: number): void {
    const sy = o.y - cam + oy;
    if (sy < -4 || sy > H + 60) return;
    const sp = getSprite(o.kind, o.size, o.variant);
    const sim = g.sim;
    // The obstacle that ended the run flashes yellow so the player sees what hit them.
    let color = WHITE;
    if (sim.killer === o && sim.crashed && Math.floor(sim.crashT * 7) % 2 === 0) color = YELLOW;
    if (color === YELLOW) {
      for (let k = 0; k < sp.pts.length; k += 2) {
        const px = o.x + (sp.pts[k] ?? 0) + ox;
        const py = sy + (sp.pts[k + 1] ?? 0);
        for (const [dx, dy] of OUTLINE) this.fb.erase(px + dx, py + dy);
      }
    }
    for (let k = 0; k < sp.pts.length; k += 2) {
      this.fb.put(o.x + (sp.pts[k] ?? 0) + ox, sy + (sp.pts[k + 1] ?? 0), color);
    }
  }

  private drawSky(g: Game, cam: number, ox: number, oy: number): void {
    if (cam > 40) return;
    for (let i = 0; i < 14; i++) {
      const sx = (i * 29 + 7) % W;
      const sy = ((i * 13) % 26) + 2;
      const on = g.reduced || Math.floor(g.animT * 1.4 + i * 1.7) % 3 !== 0;
      if (on) this.fb.put(sx + ox, sy - cam + oy);
    }
  }

  private drawBackdrop(cam: number, ox: number, oy: number): void {
    if (cam > BACKDROP_H) return;
    const b = this.backdrop;
    for (let i = 0; i < b.length; i += 2) this.fb.put((b[i] ?? 0) + ox, (b[i + 1] ?? 0) - cam + oy);
  }

  /**
   * Distant mountain ridges along the top of the screen. They slide in once the start peaks have
   * scrolled away, then drift sideways as the rider carves and descends (parallax: the far ridge
   * moves less than the near one).
   */
  private drawRidges(g: Game, cam: number): void {
    if (g.phase === 'title') return;
    const sim = g.sim;
    const slide = Math.max(0, Math.min(1, (cam - 20) / 110));
    if (slide <= 0) return;
    const drift = g.reduced ? 0 : sim.maxY;
    for (const layer of RIDGE_LAYERS) {
      const base = Math.round(layer.base - (1 - slide) * 70);
      const scroll = sim.rider.x * layer.px + drift * layer.py;
      for (let x = 0; x < W; x++) {
        const h = ridgeHeight(x + scroll, layer.seed) * layer.amp;
        const top = base - Math.round(h);
        // knock out whatever is behind (flecks, stars) under the ridge, down to the base
        for (let y = top; y < base; y++) this.fb.erase(x, y);
        if (layer.dotted ? (x + top) % 2 === 0 : true) this.fb.put(x, top);
        // a little shading on the slopes: dotted hatching just under the ridge line
        if (!layer.dotted && (x + top) % 3 === 0) {
          this.fb.put(x, top + 2);
          this.fb.put(x, top + 4);
        }
      }
    }
  }

  /** Little dashes of snow texture, scattered by a stateless hash so they need no storage. */
  private drawFlecks(cam: number, ox: number, oy: number, hud: Rect): void {
    const r0 = Math.floor(cam / 16) - 1;
    const r1 = Math.floor((cam + H) / 16) + 1;
    for (let row = r0; row <= r1; row++) {
      if (row * 16 < 130) continue;
      for (let k = 0; k < 2; k++) {
        const x = Math.floor(hash2(row, k + 11) * (W - 8)) + 2;
        const y = row * 16 + Math.floor(hash2(row, k + 3) * 16);
        const len = 2 + Math.floor(hash2(row, k + 9) * 3);
        // keep the area behind the score free of snow texture, so the numbers stay readable
        if (y - cam < hud.h + 2 && x + len > 0 && x < hud.w + 4) continue;
        for (let j = 0; j < len; j++) this.fb.put(x + j + ox, y - cam + oy);
      }
    }
  }

  /** Ice is a bare, glinting oval; a snowdrift is a stippled mound with ripples. Neither looks like a bush. */
  private drawPatch(p: Patch, cam: number, ox: number, oy: number): void {
    const cy = p.y - cam + oy;
    if (cy + p.ry < -2 || cy - p.ry > H + 2) return;
    const fb = this.fb;
    const ice = p.kind === 'ice';
    for (let dy = -p.ry; dy <= p.ry; dy++) {
      const k = Math.sqrt(Math.max(0, 1 - (dy / p.ry) * (dy / p.ry)));
      const hw = Math.round(p.rx * k);
      const wy = p.y + dy;
      for (let dx = -hw; dx <= hw; dx++) {
        const wx = p.x + dx;
        const edge = dx === -hw || dx === hw || Math.abs(dy) === p.ry;
        const x = wx + ox;
        const y = cy + dy;
        if (ice) {
          // dashed outline plus diagonal glints
          if (edge && (wx + wy) % 3 !== 0) fb.put(x, y);
          else if (!edge && (wx - wy + 4096) % 11 === p.variant && (wx + wy) % 2 === 0)
            fb.put(x, y);
        } else {
          // mound: solid crest on the upper rim, stippled body, ripple lines
          const crest = dy <= -p.ry + 1 && Math.abs(dx) < hw;
          const rim = edge && dy >= -p.ry * 0.2;
          if (crest || rim) fb.put(x, y);
          else if (!edge && (wx + 2 * wy) % 5 === 0) fb.put(x, y);
          else if (!edge && (dy + p.ry) % 7 === 4) fb.put(x, y);
        }
      }
    }
  }

  /** A kicker seen from behind: a hatched wedge rising to a solid lip, with a shadow below it. */
  private drawRamp(r: Ramp, cam: number, ox: number, oy: number): void {
    const ly = r.y - cam + oy;
    if (ly < -14 || ly > H + 6) return;
    const fb = this.fb;
    const rows = 11;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const hw = Math.round(r.half * (0.5 + 0.5 * t));
      const y = ly - (rows - 1) + i;
      fb.fillRect(r.x - hw + ox - 1, y, hw * 2 + 3, 1, OFF);
      fb.put(r.x - hw + ox, y);
      fb.put(r.x + hw + ox, y);
      const wy = r.y - (rows - 1) + i;
      for (let dx = -hw + 1; dx < hw; dx++) {
        if ((r.x + dx + wy) % 3 === 0) fb.put(r.x + dx + ox, y);
      }
    }
    // the lip, two pixels thick, with a chevron mark above it
    for (let dx = -r.half; dx <= r.half; dx++) {
      fb.put(r.x + dx + ox, ly);
      fb.put(r.x + dx + ox, ly + 1);
    }
    for (let k = 0; k < 3; k++) {
      fb.put(r.x - k + ox, ly - 5 + k);
      fb.put(r.x + k + ox, ly - 5 + k);
    }
    for (let dx = -r.half + 2; dx <= r.half; dx += 2) {
      fb.put(r.x + dx + ox, ly + 3);
    }
  }

  /** The board trail: longer and wider the faster the rider is going. */
  private drawTrail(sim: Sim, cam: number, ox: number, oy: number, tuck: number): void {
    const t = sim.trail;
    const wide = tuck > 0.35;
    const fast = tuck > 0.7;
    for (let i = 0; i < t.count; i++) {
      const x = Math.round(t.x(i)) + ox;
      const y = Math.round(t.y(i)) - cam + oy;
      if (y < -2 || y > H + 2) continue;
      this.fb.put(x, y);
      this.fb.put(x + 1, y);
      if (i % 2 === 0) {
        this.fb.put(x - 2, y);
        this.fb.put(x + 3, y);
      }
      if (wide && i % 3 === 0) {
        this.fb.put(x - 3, y);
        this.fb.put(x + 4, y);
      }
      if (fast && i % 4 === 0) {
        this.fb.put(x - 5, y);
        this.fb.put(x + 6, y);
      }
    }
  }

  /**
   * A checkpoint: two fat poles, a banner strung across the top and a dotted line on the snow.
   * The banner turns solid on success and flashes yellow for a moment after being passed.
   */
  private drawGate(g: Game, gate: Gate, cam: number, ox: number, oy: number): void {
    const fy = gate.y - cam + oy;
    if (fy < -30 || fy > H + 30) return;
    const fb = this.fb;
    const left = gate.x - gate.half + ox;
    const right = gate.x + gate.half + ox;
    const flash = g.gateFlash.get(gate.id) ?? 0;
    const hot = flash > 0 && Math.floor(flash * 12) % 2 === 0;
    const lit = gate.success;
    const color = hot ? YELLOW : WHITE;
    const poleH = 24;
    // ground line
    if (!gate.passed) {
      for (let x = left + 4; x < right - 3; x += 4) fb.put(x, fy);
    }
    // poles, 3px wide, with a black outline
    for (const px of [left, right]) {
      fb.fillRect(px - 2, fy - poleH - 1, 5, poleH + 3, OFF);
      fb.fillRect(px - 1, fy - poleH, 3, poleH + 1, color);
      // pennant on top
      const dir = px === left ? 1 : -1;
      for (let i = 0; i < 5; i++) fb.put(px + dir * (2 + i), fy - poleH + (i > 2 ? 4 - i : i));
    }
    // banner across the top
    const by = fy - poleH + 3;
    const bw = right - left - 3;
    fb.fillRect(left + 2, by - 1, bw, 8, OFF);
    for (let x = 0; x < bw; x++) {
      const bx = left + 2 + x;
      fb.put(bx, by);
      fb.put(bx, by + 5);
      for (let j = 1; j < 5; j++) {
        const checker = (Math.floor(x / 3) + j) % 2 === 0;
        if (lit ? true : checker) fb.put(bx, by + j, color);
      }
      fb.put(bx, by, color);
      fb.put(bx, by + 5, color);
    }
    if (lit) {
      // cut a notch pattern in the solid banner so it reads as a flag, not a block
      for (let x = 2; x < bw - 1; x += 6) fb.fillRect(left + 2 + x, by + 2, 2, 2, OFF);
    }
  }

  private drawPickups(g: Game, cam: number, ox: number, oy: number): void {
    for (const p of g.sim.pickups) {
      const x = p.x + ox;
      const y = p.y - cam + oy;
      if (y < -4 || y > H + 4) continue;
      const wide = g.reduced || Math.floor(g.animT * 3 + p.id) % 2 === 0;
      this.fb.put(x, y);
      this.fb.put(x - 1, y);
      this.fb.put(x + 1, y);
      this.fb.put(x, y - 1);
      this.fb.put(x, y + 1);
      if (wide) {
        this.fb.put(x - 2, y);
        this.fb.put(x + 2, y);
        this.fb.put(x, y - 2);
        this.fb.put(x, y + 2);
      } else {
        this.fb.put(x - 1, y - 1);
        this.fb.put(x + 1, y - 1);
        this.fb.put(x - 1, y + 1);
        this.fb.put(x + 1, y + 1);
      }
      if (p.lane) {
        // risk lane stars are bigger: a ring of dots around the star
        for (const [dx, dy] of RING) this.fb.put(x + dx, y + dy);
      }
    }
  }

  private style(g: Game): RiderStyle {
    const gear = g.progress.gear;
    return {
      board: Math.max(
        0,
        BOARDS.findIndex((b) => b.id === gear.board),
      ),
      rider: Math.max(
        0,
        RIDERS.findIndex((b) => b.id === gear.rider),
      ),
    };
  }

  private drawGhost(g: Game, cam: number, ox: number, oy: number): void {
    const gh = g.ghost;
    if (!gh || g.phase === 'title' || gh.crashed) return;
    const r = gh.rider;
    const sy = Math.round(r.y - cam) + oy;
    if (sy < -30 || sy > H + 30) return;
    const z = r.air ? Math.round(zOf(gh)) : 0;
    drawRider(this.fb, poseOf(r, Math.round(r.x) + ox, sy - z, 0), { ghost: true });
  }

  private drawRiderAndEffects(g: Game, cam: number, ox: number, oy: number, tuck: number): void {
    const sim = g.sim;
    const r = sim.rider;
    const sx = Math.round(r.x) + ox;
    const sy = Math.round(r.y - cam) + oy;
    if (sim.crashed) {
      if (sim.crashCause === 'avalanche') {
        // buried: only a hand and the tip of the board stick out of the snow
        drawWipeout(this.fb, sx, sy + 10, Math.min(sim.crashT, 0.75), sim.crashFace);
        return;
      }
      drawWipeout(this.fb, sx, sy + 10, sim.crashT, sim.crashFace);
      if (sim.crashT > 0.75 && !g.reduced) drawDizzy(this.fb, sx, sy + 10, g.animT);
      return;
    }
    const z = Math.round(zOf(sim));
    if (r.air) this.drawShadow(sx, sy + 8, z);
    const straight = Math.max(0, 1 - Math.abs(r.hx) / 0.4);
    const poseTuck = Math.min(1, tuck * 1.7) * straight * (r.air ? 0.4 : 1);
    const pose = poseOf(r, sx, sy - z, poseTuck);
    drawRider(this.fb, pose, { style: this.style(g), time: g.animT });
    if (!g.reduced && g.phase !== 'title' && r.speed > 10) {
      drawSnowKick(this.fb, pose, g.animT, tuck, r.air);
    }
  }

  /** A shadow on the snow under a jumping rider: it shrinks and fades as the rider climbs. */
  private drawShadow(sx: number, sy: number, z: number): void {
    const w = Math.max(2, 7 - Math.round(z / 5));
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const inside = (dx * dx) / (w * w) + (dy * dy) / 2.2 <= 1;
        if (inside && (dx + dy + 2) % 2 === 0) this.fb.put(sx + dx, sy + dy + 2);
      }
    }
  }

  private drawParticles(g: Game, cam: number, ox: number, oy: number): void {
    const p = g.particles;
    for (let i = 0; i < p.count; i++) {
      const life = p.life[i] ?? 0;
      const max = p.max[i] ?? 1;
      if (life < max * 0.25 && Math.floor(life * 20) % 2 === 0) continue;
      this.fb.put((p.x[i] ?? 0) + ox, (p.y[i] ?? 0) - cam + oy, WHITE);
    }
  }

  /**
   * The avalanche: a dithered white wall that fills the screen above its front edge, with a
   * roiling crest. Before it is on screen, a flickering edge and a warning mark tell the rider it is near.
   */
  private drawAvalanche(g: Game, cam: number, oy: number): void {
    if (g.phase === 'title') return;
    const sim = g.sim;
    const fb = this.fb;
    const t = g.reduced ? 0 : g.animT;
    const front = sim.avalanche.y - cam + oy;
    if (front > 0) {
      for (let x = 0; x < W; x++) {
        const edge = Math.round(
          3 * Math.sin(x * 0.33 + t * 3.1) + 2 * Math.sin(x * 0.11 - t * 2.3),
        );
        const fy = Math.floor(front + edge);
        for (let y = Math.max(0, fy - 40); y <= Math.min(H - 1, fy); y++) {
          const d = fy - y;
          let on: boolean;
          if (d < 2) on = true;
          else if (d < 7) on = (x + y) % 4 !== 0;
          else if (d < 16) on = (x + y) % 2 === 0;
          else on = (x + 2 * y) % 3 === 0;
          if (on) fb.put(x, y, WHITE);
          else fb.erase(x, y);
        }
        // above the dithered band the wall is simply a solid white sheet
        for (let y = 0; y < fy - 40; y++) fb.put(x, y, WHITE);
        // crest puffs above the edge
        if ((x * 7 + Math.floor(t * 6)) % 11 === 0) fb.put(x, fy + 2, WHITE);
      }
      return;
    }
    // Wall not yet on screen: crackling edge at the top, stronger the closer it is.
    const danger = sim.danger;
    if (danger > 0.2 && g.phase === 'playing') {
      const n = Math.round(danger * W * 0.5);
      const frame = Math.floor(g.animT * 24);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(hash2(frame, i) * W);
        fb.put(x, 0);
        if (danger > 0.5) fb.put(x, 1);
      }
    }
  }

  /** Falling snow that streaks upwards with the camera, plus speed lines that grow with the tuck. */
  private drawWeather(g: Game, cam: number, tuck: number, hud: Rect): void {
    const t = g.animT;
    const sim = g.sim;
    for (let i = 0; i < 40; i++) {
      const depth = 0.45 + (i % 3) * 0.25;
      const x = posMod(i * 37.7 + Math.sin(t * 0.6 + i) * 5, W);
      const y = posMod(t * (6 + (i % 5) * 2.2) + i * 53 - cam * depth, H + 8) - 4;
      if (x < hud.w + 2 && y < hud.h + 2) continue;
      this.fb.put(x, y);
    }
    if (g.phase === 'playing' && sim.rider.speed > 120) {
      const n = Math.floor(tuck * 16) + Math.floor(Math.max(0, sim.rider.speed - 120) / 40);
      const len = 3 + Math.round(tuck * 9);
      const sp = 1 + tuck * 1.5;
      for (let i = 0; i < n; i++) {
        const x = Math.floor(hash2(i, 99) * W);
        // streaks move up the screen faster than the ground, in a loop
        const y = Math.floor(posMod(hash2(99, i) * (H + 20) - cam * sp - 10, H + 20)) - 10;
        if (x < hud.w + 2 && y < hud.h + 2) continue;
        for (let j = 0; j < len; j++) this.fb.put(x, y + j);
      }
    }
  }

  /** Brief zoom on the rider after an impact or a near miss: a nearest-neighbour blow up of the scene. */
  private zoomPunch(g: Game): Framebuffer {
    const k = g.reduced ? 0 : g.punch;
    if (k < 0.04) return this.fb;
    const z = 1 + 0.06 * Math.min(1, k);
    const r = g.sim.rider;
    const cx = Math.max(20, Math.min(W - 20, Math.round(r.x)));
    const cy = Math.max(40, Math.min(H - 40, Math.round(r.y - g.camYi)));
    const src = this.fb;
    const dst = this.zoomed;
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(cy + (y - cy) / z);
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(cx + (x - cx) / z);
        dst.put(x, y, src.get(sx, sy));
      }
    }
    return dst;
  }
}

const OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
];

const RING: ReadonlyArray<readonly [number, number]> = [
  [-3, -1],
  [-3, 1],
  [3, -1],
  [3, 1],
  [-1, -3],
  [1, -3],
  [-1, 3],
  [1, 3],
];

interface RidgeLayer {
  base: number;
  amp: number;
  /** Horizontal scroll per px of rider x, and per px of descent. */
  px: number;
  py: number;
  seed: number;
  dotted: boolean;
}

const RIDGE_LAYERS: readonly RidgeLayer[] = [
  { base: 34, amp: 1, px: 0.1, py: 0.03, seed: 3, dotted: true },
  { base: 46, amp: 1, px: 0.22, py: 0.07, seed: 11, dotted: false },
];

/** Smooth value noise in px: a ridge line made of overlapping peaks. */
function ridgeHeight(x: number, seed: number): number {
  const f = (s: number, step: number): number => {
    const i = Math.floor(x / step);
    const t = x / step - i;
    const a = hash2(i, seed + s);
    const b = hash2(i + 1, seed + s);
    const k = t * t * (3 - 2 * t);
    return a + (b - a) * k;
  };
  return 6 + 16 * f(0, 38) + 8 * f(1, 17) + 3 * f(2, 7);
}

/** Height above the snow (px) of a sim's rider. */
function zOf(sim: Sim): number {
  const r = sim.rider;
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}
