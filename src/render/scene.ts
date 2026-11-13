import { W } from '../core/config';
import type { DeepReadonly, GameView } from '../state/view';
import { hash2 } from '../core/rng';
import { poseOf } from '../sim/pose';
import type { Obstacle, Ramp } from '../sim/types';
import { BACKDROP_H, buildBackdrop } from './backdrop';
import { OFF, type Framebuffer } from './framebuffer';
import {
  drawColorCliff,
  drawColorKicker,
  linePips,
  RAMP_HEIGHT,
  RAMP_ROWS,
  rampHalfAt,
} from './terrain';
import { MONO, paletteFor, type Palette } from './palette';
import { drawRider, drawWipeout, type RiderStyle } from './riderSprite';
import { getColorSprite, getSprite } from './sprites';
import { BOARDS, RIDERS } from '../state/progress';
import { hudRect, riderZ, type Rect } from './layout';
import { TrackPainter } from './track';

/** Draws the whole world (not the UI) into a framebuffer from the current game state. */
export class SceneRenderer {
  private readonly backdrop = { mono: buildBackdrop(false), color: buildBackdrop(true) };
  private readonly track = new TrackPainter();
  /** The palette of the frame being drawn, set at the start of every render. */
  private pal: Palette = MONO;

  /**
   * `top` is how many rows of slope the buffer holds above the 180x320 frame (the HUD's frame), so that on a tall
   * phone the slope reaches the screen's edges. The frame starts at row `top` and the buffer runs on below it.
   */
  constructor(
    private readonly fb: Framebuffer,
    private readonly top = 0,
  ) {}

  render(g: GameView): Framebuffer {
    const fb = this.fb;
    const sim = g.sim;
    const pal = paletteFor(g.settings.color);
    this.pal = pal;
    fb.clear(pal.snow);
    const tuck = g.phase === 'playing' || g.phase === 'paused' ? sim.tuck : 0;
    // The camera's row is the frame's top row; the buffer starts `top` rows above it.
    const cam = g.camYi - this.top;
    const toY = (y: number): number => y - cam;

    if (!pal.color) this.drawSky(cam);
    this.drawBackdrop(cam);
    this.drawFlecks(cam, hudRect(g.settings.bigHud));
    for (const r of sim.ramps) {
      if (r.kind === 'cliff') this.drawCliff(r, cam);
      else this.drawRamp(r, cam);
    }
    this.track.draw(fb, sim.trail, cam, g.progress.gear.kit === 'skis', pal);
    this.drawLanded(g, cam);
    this.drawPickups(g, cam);

    // Cast shadows first, so every sprite sits on top of every shadow.
    for (const o of sim.obstacles) {
      const sy = toY(o.y);
      const sp = getSprite(o.kind, o.size, o.variant);
      if (this.offscreen(sp, sy)) continue;
      for (let i = 0; i < sp.shadow.length; i += 2) {
        const dx = sp.shadow[i] ?? 0;
        const dy = sp.shadow[i + 1] ?? 0;
        // dither by world coordinates so the pattern does not shimmer while scrolling
        if ((o.x + dx + o.y + dy) % 2 === 0) fb.put(o.x + dx, sy + dy, pal.shadow);
      }
    }

    // Depth sort: obstacles whose base is above the rider's feet are behind the rider.
    const feetY = g.riderY + 8;
    const obs = sim.obstacles;
    let i = 0;
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (!o || o.y > feetY) break;
      this.drawObstacle(g, o, cam);
    }
    this.drawPuffs(g, cam);
    this.drawRiderAndEffects(g, cam, tuck);
    for (; i < obs.length; i++) {
      const o = obs[i];
      if (o) this.drawObstacle(g, o, cam);
    }

    this.drawParticles(g, cam);
    // Labels sit on things in the world, so they scroll with it.
    return fb;
  }

  private drawObstacle(g: GameView, o: DeepReadonly<Obstacle>, cam: number): void {
    const sy = o.y - cam;
    const sp = getSprite(o.kind, o.size, o.variant);
    if (this.offscreen(sp, sy)) return;
    const pal = this.pal;
    const sim = g.sim;
    // The obstacle that ended the run flashes yellow so the player sees what hit them.
    const hit = sim.killer === o && sim.crashed && Math.floor(sim.crashT * 7) % 2 === 0;
    if (hit) {
      for (let k = 0; k < sp.pts.length; k += 2) {
        const px = o.x + (sp.pts[k] ?? 0);
        const py = sy + (sp.pts[k + 1] ?? 0);
        for (const [dx, dy] of OUTLINE) this.fb.put(px + dx, py + dy, pal.snow);
      }
      for (let k = 0; k < sp.pts.length; k += 2) {
        this.fb.put(o.x + (sp.pts[k] ?? 0), sy + (sp.pts[k + 1] ?? 0), pal.hit);
      }
      return;
    }
    if (pal.color) {
      const cs = getColorSprite(o.kind, o.size, o.variant);
      for (let k = 0; k < cs.colors.length; k++) {
        this.fb.put(o.x + (cs.pts[k * 2] ?? 0), sy + (cs.pts[k * 2 + 1] ?? 0), cs.colors[k]);
      }
      return;
    }
    for (let k = 0; k < sp.pts.length; k += 2) {
      this.fb.put(o.x + (sp.pts[k] ?? 0), sy + (sp.pts[k + 1] ?? 0));
    }
  }

  /**
   * Whether a sprite with its base on row `sy` misses the buffer entirely: its shadow falls below the base and it rises
   * above it, so both ends count, with a pixel to spare for the snow edging of colour sprites.
   */
  private offscreen(sp: { readonly top: number; readonly bottom: number }, sy: number): boolean {
    return sy + sp.bottom < -2 || sy + sp.top > this.fb.h + 2;
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
    // Above the start area (only ever seen past the top of the frame on a tall phone) the sky carries on.
    if (cam < 0) this.fb.fillRect(0, 0, W, -cam, this.pal.sky);
    const b = this.pal.color ? this.backdrop.color : this.backdrop.mono;
    for (let k = 0; k < b.colors.length; k++) {
      this.fb.put(b.pts[k * 2] ?? 0, (b.pts[k * 2 + 1] ?? 0) - cam, b.colors[k]);
    }
  }

  /** Little dashes of snow texture, scattered by a stateless hash so they need no storage. */
  private drawFlecks(cam: number, hud: Readonly<Rect>): void {
    const r0 = Math.floor(cam / 16) - 1;
    const r1 = Math.floor((cam + this.fb.h) / 16) + 1;
    for (let row = r0; row <= r1; row++) {
      if (row * 16 < 130) continue;
      for (let k = 0; k < 2; k++) {
        const x = Math.floor(hash2(row, k + 11) * (W - 8)) + 2;
        const y = row * 16 + Math.floor(hash2(row, k + 3) * 16);
        const len = 2 + Math.floor(hash2(row, k + 9) * 3);
        // keep the area behind the score free of snow texture, so the numbers stay readable
        if (y - cam - this.top < hud.h + 2 && x + len > 0 && x < hud.w + 4) continue;
        for (let j = 0; j < len; j++) this.fb.put(x + j, y - cam, this.pal.fleck);
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
    if (ly < -40 || ly > this.fb.h + 12) return;
    if (this.pal.color) {
      drawColorCliff(this.fb, r, ly);
      return;
    }
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

  /**
   * A kicker seen from behind, as you ride up to it: an outlined trapezoid that widens toward a thick
   * lip, with two arrows on its face pointing downhill (the way you ride over it) and a hard shadow
   * past the lip. Nothing else on the hill has straight edges and arrows, so it never reads as a
   * tree, rock or bush, and the cliffs' warning chevrons point the other way.
   */
  private drawRamp(r: DeepReadonly<Ramp>, cam: number): void {
    const ly = r.y - cam;
    // The face rises RAMP_ROWS above the lip and the shadow falls below it.
    if (ly < -RAMP_ROWS - 2 || ly - RAMP_ROWS > this.fb.h + 2) return;
    if (this.pal.color) {
      drawColorKicker(this.fb, r, cam);
      return;
    }
    const fb = this.fb;
    const rows = RAMP_ROWS;
    const halfAt = (i: number): number => rampHalfAt(r.half, i);
    // Cast shadow, the same rule as the tree sprites (castShadow): the jump rises toward the lip, a point at
    // height h lands 0.85h + 1 to the right and 0.28h + 1 down. Drawn first so the jump sits on top of it.
    for (let i = 0; i < rows; i++) {
      const hw = halfAt(i);
      const h = 1 + ((RAMP_HEIGHT - 1) * i) / (rows - 1);
      const wy = r.y - (rows - 1) + i;
      const sy = Math.round(wy + 1 + h * 0.28);
      for (let dx = -hw; dx <= hw; dx++) {
        const sx = Math.round(r.x + dx + h * 0.85 + 1);
        if ((sx + sy) % 2 === 0) fb.put(sx, sy - cam);
      }
    }
    // the face: cleared to the snow, a solid outline with the back edge closed
    for (let i = 0; i < rows; i++) {
      const hw = halfAt(i);
      const y = ly - (rows - 1) + i;
      fb.fillRect(r.x - hw, y, hw * 2 + 1, 1, OFF);
      if (i === 0) fb.fillRect(r.x - hw, y, hw * 2 + 1, 1);
      fb.put(r.x - hw, y);
      fb.put(r.x + hw, y);
    }
    // two arrows on the face, two pixels thick, pointing down the hill
    const arm = 5;
    for (const top of [ly - rows + 4, ly - rows + 9]) {
      for (let k = 0; k <= arm; k++) {
        for (let t = 0; t < 2; t++) {
          fb.put(r.x - arm + k, top + k + t);
          fb.put(r.x + arm - k, top + k + t);
        }
      }
    }
    // the lip: two pixels thick and a pixel wider than the face, then a black gap where the snow drops away
    fb.fillRect(r.x - r.half - 1, ly, r.half * 2 + 3, 2);
    fb.fillRect(r.x - r.half - 1, ly + 2, r.half * 2 + 3, 1, OFF);
    // a jump line's pips: filled up to this kicker, hollow after it
    for (const p of linePips(r, cam)) {
      if (p.filled) fb.fillRect(p.x, p.y, p.size, p.size);
      else fb.strokeRect(p.x, p.y, p.size, p.size);
    }
  }

  /** Lane stars are solid five-point stars, the one thing on the slope shaped like a reward. */
  private drawPickups(g: GameView, cam: number): void {
    for (const p of g.sim.pickups) {
      const y = p.y - cam;
      if (y < -5 || y > this.fb.h + 5) continue;
      for (const [dx, dy] of STAR) this.fb.put(p.x + dx, y + dy, this.pal.star);
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
      skis: gear.kit === 'skis',
    };
  }

  private drawRiderAndEffects(g: GameView, cam: number, tuck: number): void {
    const sim = g.sim;
    const r = sim.rider;
    // At the screen's moment, like the camera, so he moves as smoothly as the slope.
    const sx = Math.round(g.riderX);
    const sy = Math.round(g.riderY - cam);
    if (sim.crashed) {
      drawWipeout(
        this.fb,
        sx,
        sy + 10,
        sim.crashT,
        sim.crashFace,
        g.progress.gear.kit === 'skis',
        this.pal,
      );
      return;
    }
    const z = Math.round(riderZ(sim));
    if (r.air) this.drawShadow(sx, sy + 8, z);
    const straight = Math.max(0, 1 - Math.abs(r.hx) / 0.4);
    const poseTuck = Math.min(1, tuck * 1.7) * straight * (r.air ? 0.4 : 1);
    const pose = poseOf(r, sx, sy - z, poseTuck);
    drawRider(this.fb, pose, {
      style: this.style(g),
      time: g.animT,
      brake: r.brake,
      palette: this.pal,
    });
  }

  /** A shadow on the snow under a jumping rider: it shrinks and fades as the rider climbs. */
  private drawShadow(sx: number, sy: number, z: number): void {
    const w = Math.max(2, 7 - Math.round(z / 5));
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const inside = (dx * dx) / (w * w) + (dy * dy) / 2.2 <= 1;
        if (inside && (dx + dy + 2) % 2 === 0) this.fb.put(sx + dx, sy + dy + 2, this.pal.shadow);
      }
    }
  }

  private drawParticles(g: GameView, cam: number): void {
    const p = g.particles;
    for (let i = 0; i < p.count; i++) this.fb.put(p.x[i] ?? 0, (p.y[i] ?? 0) - cam, this.pal.spray);
  }

  /**
   * Powder clouds behind the rider. Each disc is dithered against the world grid (a 4x4 ordered pattern), so
   * a thinning cloud loses pixels in a fixed order instead of flickering. The shadow side (lower right) and the
   * densest middle of a fresh puff are drawn in the deeper spray tone, which gives the cloud its volume.
   */
  private drawPuffs(g: GameView, cam: number): void {
    const p = g.puffs;
    for (let i = 0; i < p.count; i++) {
      const cx = p.x[i] ?? 0;
      const cy = p.y[i] ?? 0;
      const r = p.r[i] ?? 0;
      const fill = p.fill[i] ?? 0;
      const x0 = Math.floor(cx - r);
      const x1 = Math.ceil(cx + r);
      const y0 = Math.floor(cy - r);
      const y1 = Math.ceil(cy + r);
      for (let wy = y0; wy <= y1; wy++) {
        for (let wx = x0; wx <= x1; wx++) {
          const dx = wx - cx;
          const dy = wy - cy;
          const d = Math.sqrt(dx * dx + dy * dy) / Math.max(1, r);
          if (d > 1) continue;
          // fuller in the middle, soft at the rim
          const local = fill * (1.15 - d * 0.75);
          const level = BAYER[(wy & 3) * 4 + (wx & 3)] ?? 0;
          if (local * 16 <= level) continue;
          // Lit from the left like everything else: the lower right of each puff is its shadow side.
          const shade = dx + dy > r * 0.25 || local > 0.8;
          this.fb.put(wx, wy - cam, shade ? this.pal.spray : this.pal.powder);
        }
      }
    }
  }

  /** Spray that has come down. Drawn under everything standing on the snow. */
  private drawLanded(g: GameView, cam: number): void {
    const p = g.particles;
    for (let i = 0; i < p.landedCount; i++) {
      this.fb.put(p.landedX[i] ?? 0, (p.landedY[i] ?? 0) - cam, this.pal.spray);
    }
  }
}

/** A 4x4 ordered dither: the order pixels drop out of a thinning cloud. */
const BAYER: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

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

/** A 7x7 five-point star centred on the pickup: a tip, wide arms, then two legs. */
const STAR: ReadonlyArray<readonly [number, number]> = [
  '...#...',
  '...#...',
  '#######',
  '.#####.',
  '..###..',
  '.##.##.',
  '##...##',
].flatMap((row, y) => [...row].flatMap((c, x) => (c === '#' ? [[x - 3, y - 3] as const] : [])));

/** Height above the snow (px) of a sim's rider. */
