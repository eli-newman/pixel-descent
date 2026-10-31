import { H, W } from '../core/config';
import type { DeepReadonly, GameView, SimView } from '../state/view';
import { hash2 } from '../core/rng';
import { poseOf } from '../sim/pose';
import type { Obstacle, Patch, Ramp } from '../sim/types';
import { BACKDROP_H, buildBackdrop } from './backdrop';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { drawRider, drawWipeout, type RiderStyle } from './riderSprite';
import { getSprite } from './sprites';
import { BOARDS, RIDERS } from '../state/progress';
import { hudRect, type Rect } from './layout';
import { TrackPainter } from './track';

/** How tall a kicker is for its cast shadow, in pixels at the lip. */
const RAMP_HEIGHT = 8;

/** Draws the whole world (not the UI) into a framebuffer from the current game state. */
export class SceneRenderer {
  private readonly backdrop = buildBackdrop();
  private readonly track = new TrackPainter();

  constructor(private readonly fb: Framebuffer) {}

  render(g: GameView): Framebuffer {
    const fb = this.fb;
    const sim = g.sim;
    fb.clear(OFF);
    const tuck = g.phase === 'playing' || g.phase === 'paused' ? sim.tuck : 0;
    const cam = g.camYi;
    const toY = (y: number): number => y - cam;

    this.drawSky(cam);
    this.drawBackdrop(cam);
    this.drawFlecks(cam, hudRect(g.settings.bigHud));
    for (const p of sim.patches) this.drawPatch(p, cam);
    for (const r of sim.ramps) {
      if (r.kind === 'cliff') this.drawCliff(r, cam);
      else this.drawRamp(r, cam);
    }
    this.track.draw(fb, sim.trail, cam);
    this.drawLanded(g, cam);
    this.drawPickups(g, cam);

    // Cast shadows first, so every sprite sits on top of every shadow.
    for (const o of sim.obstacles) {
      const sy = toY(o.y);
      if (sy < -4 || sy > H + 60) continue;
      const sp = getSprite(o.kind, o.size, o.variant);
      for (let i = 0; i < sp.shadow.length; i += 2) {
        const dx = sp.shadow[i] ?? 0;
        const dy = sp.shadow[i + 1] ?? 0;
        // dither by world coordinates so the pattern does not shimmer while scrolling
        if ((o.x + dx + o.y + dy) % 2 === 0) fb.put(o.x + dx, sy + dy);
      }
    }

    // Depth sort: obstacles whose base is above the rider's feet are behind the rider.
    const feetY = sim.rider.y + 8;
    const obs = sim.obstacles;
    let i = 0;
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (!o || o.y > feetY) break;
      this.drawObstacle(g, o, cam);
    }
    this.drawRiderAndEffects(g, cam, tuck);
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (o) this.drawObstacle(g, o, cam);
    }

    this.drawParticles(g, cam);
    return fb;
  }

  private drawObstacle(g: GameView, o: DeepReadonly<Obstacle>, cam: number): void {
    const sy = o.y - cam;
    if (sy < -4 || sy > H + 60) return;
    const sp = getSprite(o.kind, o.size, o.variant);
    const sim = g.sim;
    // The obstacle that ended the run flashes yellow so the player sees what hit them.
    let color = WHITE;
    if (sim.killer === o && sim.crashed && Math.floor(sim.crashT * 7) % 2 === 0) color = YELLOW;
    if (color === YELLOW) {
      for (let k = 0; k < sp.pts.length; k += 2) {
        const px = o.x + (sp.pts[k] ?? 0);
        const py = sy + (sp.pts[k + 1] ?? 0);
        for (const [dx, dy] of OUTLINE) this.fb.erase(px + dx, py + dy);
      }
    }
    for (let k = 0; k < sp.pts.length; k += 2) {
      this.fb.put(o.x + (sp.pts[k] ?? 0), sy + (sp.pts[k + 1] ?? 0), color);
    }
  }

  private drawSky(cam: number): void {
    if (cam > 40) return;
    for (let i = 0; i < 14; i++) {
      const sx = (i * 29 + 7) % W;
      const sy = ((i * 13) % 26) + 2;
      this.fb.put(sx, sy - cam);
    }
  }

  private drawBackdrop(cam: number): void {
    if (cam > BACKDROP_H) return;
    const b = this.backdrop;
    for (let i = 0; i < b.length; i += 2) this.fb.put(b[i] ?? 0, (b[i + 1] ?? 0) - cam);
  }

  /** Little dashes of snow texture, scattered by a stateless hash so they need no storage. */
  private drawFlecks(cam: number, hud: Readonly<Rect>): void {
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
        for (let j = 0; j < len; j++) this.fb.put(x + j, y - cam);
      }
    }
  }

  /** Ice is a bare, glinting oval; a snowdrift is a stippled mound with ripples. Neither looks like a bush. */
  private drawPatch(p: DeepReadonly<Patch>, cam: number): void {
    const cy = p.y - cam;
    if (cy + p.ry < -2 || cy - p.ry > H + 2) return;
    const fb = this.fb;
    const ice = p.kind === 'ice';
    for (let dy = -p.ry; dy <= p.ry; dy++) {
      const k = Math.sqrt(Math.max(0, 1 - (dy / p.ry) * (dy / p.ry)));
      const hw = Math.round(p.rx * k);
      const wy = p.y + dy;
      for (let dx = -hw; dx <= hw; dx++) {
        const x = p.x + dx;
        const edge = dx === -hw || dx === hw || Math.abs(dy) === p.ry;
        const y = cy + dy;
        if (ice) {
          // dashed outline plus diagonal glints
          if (edge && (x + wy) % 3 !== 0) fb.put(x, y);
          else if (!edge && (x - wy + 4096) % 11 === p.variant && (x + wy) % 2 === 0) fb.put(x, y);
        } else {
          // mound: solid crest on the upper rim, stippled body, ripple lines
          const crest = dy <= -p.ry + 1 && Math.abs(dx) < hw;
          const rim = edge && dy >= -p.ry * 0.2;
          if (crest || rim) fb.put(x, y);
          else if (!edge && (x + 2 * wy) % 5 === 0) fb.put(x, y);
          else if (!edge && (dy + p.ry) % 7 === 4) fb.put(x, y);
        }
      }
    }
  }

  /**
   * A cliff seen from above, built from chunks of rock along a wandering line. Each chunk is a blocky
   * wall: a snow cap on a stepped lip, broken horizontal strata with short joints between them, and
   * a flat foot with a hard shadow. The ends step down in stairs instead of fading, so it reads as
   * stone and not as water running down. Between and beside the chunks is open slope you can ride
   * down. Every cliff is seeded, so no two look alike.
   */
  private drawCliff(r: DeepReadonly<Ramp>, cam: number): void {
    const ly = Math.round(r.y - cam);
    if (ly < -40 || ly > H + 12) return;
    const fb = this.fb;
    const sd = r.seed * 7;
    const BLOCK = 10;
    for (let x = 0; x < W; x++) {
      const seg = r.segs.find((c) => x >= c.x0 && x < c.x1);
      if (!seg) {
        // open slope: plain snow like the rest of the hill, so nothing shimmers between the rock
        for (let y = ly - 4; y <= ly + 34; y++) fb.erase(x, y);
        continue;
      }
      const blk = Math.floor(x / BLOCK);
      // stepped lip: every block sits a couple of pixels higher or lower than its neighbour
      const lip = ly + seg.dy + Math.floor(hash2(blk + sd, 5) * 5) - 2;
      // the face is a different height in every block, and the ends of a chunk step down in stairs
      const edge = Math.min(x - seg.x0, seg.x1 - 1 - x);
      const endScale = [0.4, 0.6, 0.8][Math.min(2, Math.floor(edge / 4))] ?? 1;
      const faceH = Math.max(
        5,
        Math.round((16 + Math.floor(hash2(blk + sd, 2) * 4) * 4) * (edge >= 12 ? 1 : endScale)),
      );
      const foot = lip + faceH;
      for (let y = lip - 4; y <= foot + 5; y++) fb.erase(x, y);
      // snow cap
      fb.put(x, lip);
      fb.put(x, lip + 1);
      if (hash2(Math.floor(x / 2) + sd, 8) > 0.55) fb.put(x, lip - 1);
      // side walls of the chunk and of each block step
      const stepEdge = x % BLOCK === 0 && hash2(blk + sd, 2) !== hash2(blk - 1 + sd, 2);
      const wall = edge === 0 || (stepEdge && hash2(blk + sd, 6) > 0.4);
      for (let y = lip + 2; y < foot; y++) {
        const d = y - lip;
        // broken strata: horizontal lines with gaps, the way layered rock shows up
        const strata = d % 5 === 2 && hash2(Math.floor((x + d * 3) / 7) + sd, d) > 0.22;
        // short joints between the strata lines
        const joint =
          d % 5 !== 2 &&
          (x + Math.floor(d / 5) * 4 + Math.floor(hash2(sd, Math.floor(d / 5)) * 9)) % 13 === 0;
        if (wall || strata || joint) fb.put(x, y);
      }
      // flat foot and a hard shadow under it
      fb.put(x, foot);
      fb.put(x, foot + 1);
      if ((x + foot) % 2 === 0) fb.put(x, foot + 2);
      if (x % 2 === 0 && hash2(x + sd, 9) > 0.35) fb.put(x, foot + 3);
    }
    // a warning chevron above each chunk of rock
    for (const c of r.segs) {
      const cx = Math.round((c.x0 + c.x1) / 2);
      for (let k = 0; k < 4; k++) {
        fb.put(cx - k, ly + c.dy - 10 + k);
        fb.put(cx + k, ly + c.dy - 10 + k);
      }
    }
  }

  /** A kicker seen from behind: a hatched wedge rising to a solid lip, with a shadow below it. */
  private drawRamp(r: DeepReadonly<Ramp>, cam: number): void {
    const ly = r.y - cam;
    if (ly < -14 || ly > H + 6) return;
    const fb = this.fb;
    const rows = 11;
    // Cast shadow, the same rule as the tree sprites (castShadow): the jump rises toward the lip, a point at
    // height h lands 0.85h + 1 to the right and 0.28h + 1 down. Drawn first so the jump sits on top of it.
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const hw = Math.round(r.half * (0.5 + 0.5 * t));
      const h = 1 + (RAMP_HEIGHT - 1) * t;
      const wy = r.y - (rows - 1) + i;
      const sy = Math.round(wy + 1 + h * 0.28);
      for (let dx = -hw; dx <= hw; dx++) {
        const sx = Math.round(r.x + dx + h * 0.85 + 1);
        if ((sx + sy) % 2 === 0) fb.put(sx, sy - cam);
      }
    }
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const hw = Math.round(r.half * (0.5 + 0.5 * t));
      const y = ly - (rows - 1) + i;
      fb.fillRect(r.x - hw - 1, y, hw * 2 + 3, 1, OFF);
      fb.put(r.x - hw, y);
      fb.put(r.x + hw, y);
      const wy = r.y - (rows - 1) + i;
      for (let dx = -hw + 1; dx < hw; dx++) {
        if ((r.x + dx + wy) % 3 === 0) fb.put(r.x + dx, y);
      }
    }
    // the lip, two pixels thick, with a chevron mark above it
    for (let dx = -r.half; dx <= r.half; dx++) {
      fb.put(r.x + dx, ly);
      fb.put(r.x + dx, ly + 1);
    }
    for (let k = 0; k < 3; k++) {
      fb.put(r.x - k, ly - 5 + k);
      fb.put(r.x + k, ly - 5 + k);
    }
    for (let dx = -r.half + 2; dx <= r.half; dx += 2) {
      fb.put(r.x + dx, ly + 3);
    }
  }

  private drawPickups(g: GameView, cam: number): void {
    for (const p of g.sim.pickups) {
      const x = p.x;
      const y = p.y - cam;
      if (y < -4 || y > H + 4) continue;
      this.fb.put(x, y);
      this.fb.put(x - 1, y);
      this.fb.put(x + 1, y);
      this.fb.put(x, y - 1);
      this.fb.put(x, y + 1);
      this.fb.put(x - 2, y);
      this.fb.put(x + 2, y);
      this.fb.put(x, y - 2);
      this.fb.put(x, y + 2);
      if (p.lane) {
        // risk lane stars are bigger: a ring of dots around the star
        for (const [dx, dy] of RING) this.fb.put(x + dx, y + dy);
      }
    }
  }

  private style(g: GameView): RiderStyle {
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

  private drawRiderAndEffects(g: GameView, cam: number, tuck: number): void {
    const sim = g.sim;
    const r = sim.rider;
    const sx = Math.round(r.x);
    const sy = Math.round(r.y - cam);
    if (sim.crashed) {
      drawWipeout(this.fb, sx, sy + 10, sim.crashT, sim.crashFace);
      return;
    }
    const z = Math.round(zOf(sim));
    if (r.air) this.drawShadow(sx, sy + 8, z);
    const straight = Math.max(0, 1 - Math.abs(r.hx) / 0.4);
    const poseTuck = Math.min(1, tuck * 1.7) * straight * (r.air ? 0.4 : 1);
    const pose = poseOf(r, sx, sy - z, poseTuck);
    drawRider(this.fb, pose, { style: this.style(g), time: g.animT });
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

  private drawParticles(g: GameView, cam: number): void {
    const p = g.particles;
    for (let i = 0; i < p.count; i++) this.fb.put(p.x[i] ?? 0, (p.y[i] ?? 0) - cam, WHITE);
  }

  /** Spray that has come down. Drawn under everything standing on the snow. */
  private drawLanded(g: GameView, cam: number): void {
    const p = g.particles;
    for (let i = 0; i < p.landedCount; i++) {
      this.fb.put(p.landedX[i] ?? 0, (p.landedY[i] ?? 0) - cam, WHITE);
    }
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

/** Height above the snow (px) of a sim's rider. */
function zOf(sim: SimView): number {
  const r = sim.rider;
  if (!r.air || r.airDur <= 0) return 0;
  const u = Math.min(1, r.airT / r.airDur);
  return 4 * r.airH * u * (1 - u);
}
