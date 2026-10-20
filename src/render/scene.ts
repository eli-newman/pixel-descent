import { H, W } from '../config';
import type { Game } from '../game';
import { hash2 } from '../rng';
import { poseOf } from '../rider';
import type { Gate } from '../world/types';
import { BACKDROP_H, buildBackdrop } from './backdrop';
import { Framebuffer, OFF, WHITE } from './framebuffer';
import { drawDizzy, drawRider, drawSnowKick, drawWipeout } from './riderSprite';
import { getSprite } from './sprites';

function posMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Draws the whole world (not the UI) into a framebuffer from the current game state. */
export class SceneRenderer {
  private readonly backdrop = buildBackdrop();

  constructor(private readonly fb: Framebuffer) {}

  render(g: Game): void {
    const fb = this.fb;
    fb.clear(OFF);
    const reduced = g.reduced;
    const shakeK = reduced ? 0 : Math.min(1, g.shake * 4);
    const ox = Math.round(Math.sin(g.animT * 95) * 2 * shakeK);
    const oy = Math.round(Math.cos(g.animT * 80) * 2 * shakeK);
    const cam = g.camYi;
    const toY = (y: number): number => y - cam + oy;

    this.drawSky(g, cam, ox, oy);
    this.drawBackdrop(cam, ox, oy);
    this.drawFlecks(cam, ox, oy);
    this.drawTrail(g, cam, ox, oy);
    for (const gate of g.gates) this.drawGate(gate, cam, ox, oy);
    this.drawPickups(g, cam, ox, oy);

    // Cast shadows first, so every sprite sits on top of every shadow.
    for (const o of g.obstacles) {
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
    const feetY = g.rider.y + 8;
    let i = 0;
    for (; i < g.obstacles.length; i++) {
      const o = g.obstacles[i];
      if (!o || o.y > feetY) break;
      this.drawObstacle(o.kind, o.size, o.variant, o.x, o.y, cam, ox, oy);
    }
    this.drawRiderAndEffects(g, cam, ox, oy);
    for (; i < g.obstacles.length; i++) {
      const o = g.obstacles[i];
      if (o) this.drawObstacle(o.kind, o.size, o.variant, o.x, o.y, cam, ox, oy);
    }

    this.drawParticles(g, cam, ox, oy);
    if (!reduced) this.drawWeather(g, cam);
  }

  private drawObstacle(
    kind: Parameters<typeof getSprite>[0],
    size: number,
    variant: number,
    x: number,
    y: number,
    cam: number,
    ox: number,
    oy: number,
  ): void {
    const sy = y - cam + oy;
    if (sy < -4 || sy > H + 60) return;
    const sp = getSprite(kind, size, variant);
    for (let i = 0; i < sp.pts.length; i += 2) {
      this.fb.put(x + (sp.pts[i] ?? 0) + ox, sy + (sp.pts[i + 1] ?? 0));
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

  /** Little dashes of snow texture, scattered by a stateless hash so they need no storage. */
  private drawFlecks(cam: number, ox: number, oy: number): void {
    const r0 = Math.floor(cam / 16) - 1;
    const r1 = Math.floor((cam + H) / 16) + 1;
    for (let row = r0; row <= r1; row++) {
      if (row * 16 < 130) continue;
      for (let k = 0; k < 2; k++) {
        const x = Math.floor(hash2(row, k + 11) * (W - 8)) + 2;
        const y = row * 16 + Math.floor(hash2(row, k + 3) * 16);
        const len = 2 + Math.floor(hash2(row, k + 9) * 3);
        for (let j = 0; j < len; j++) this.fb.put(x + j + ox, y - cam + oy);
      }
    }
  }

  private drawTrail(g: Game, cam: number, ox: number, oy: number): void {
    const t = g.trail;
    for (let i = 0; i < t.length; i++) {
      const p = t[i];
      if (!p) continue;
      const x = Math.round(p.x) + ox;
      const y = Math.round(p.y) - cam + oy;
      this.fb.put(x, y);
      this.fb.put(x + 1, y);
      if (i % 2 === 0) {
        this.fb.put(x - 2, y);
        this.fb.put(x + 3, y);
      }
    }
  }

  private drawGate(gate: Gate, cam: number, ox: number, oy: number): void {
    const fy = gate.y - cam + oy;
    if (fy < -4 || fy > H + 30) return;
    const lit = gate.success;
    const left = gate.x - gate.half + ox;
    const right = gate.x + gate.half + ox;
    for (const px0 of [left, right]) {
      const dir = px0 === left ? -1 : 1;
      for (let j = 0; j < 12; j++) this.fb.put(px0, fy - j);
      for (let i = 1; i <= 6; i++) {
        const rows = 5 - Math.floor(i / 2);
        for (let j = 0; j < rows; j++) {
          if (lit || j === 0 || j === rows - 1 || i === 6) this.fb.put(px0 + dir * i, fy - 12 + j);
        }
      }
      if (lit) for (let k = 0; k < 3; k++) this.fb.put(px0 + dir * 8 + (k % 2), fy - 9 - k * 2);
    }
    if (!gate.passed) {
      for (let x = left + 3; x < right - 2; x += 4) this.fb.put(x, fy);
    }
  }

  private drawPickups(g: Game, cam: number, ox: number, oy: number): void {
    for (const p of g.pickups) {
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
    }
  }

  private drawRiderAndEffects(g: Game, cam: number, ox: number, oy: number): void {
    const r = g.rider;
    const sx = Math.round(r.x) + ox;
    const sy = Math.round(r.y - cam) + oy;
    if (g.phase === 'crashed' || g.phase === 'over') {
      drawWipeout(this.fb, sx, sy + 10, g.crashT, g.crashFace);
      if (g.crashT > 0.75 && !g.reduced) drawDizzy(this.fb, sx, sy + 10, g.animT);
      return;
    }
    const pose = poseOf(r, sx, sy);
    drawRider(this.fb, pose);
    if (!g.reduced && g.phase !== 'title' && r.speed > 10) drawSnowKick(this.fb, pose, g.animT);
  }

  private drawParticles(g: Game, cam: number, ox: number, oy: number): void {
    for (const p of g.particles) {
      if (p.life < p.max * 0.25 && Math.floor(p.life * 20) % 2 === 0) continue;
      this.fb.put(p.x + ox, p.y - cam + oy, WHITE);
    }
  }

  /** Falling snow that streaks upwards with the camera, plus speed lines at high speed. */
  private drawWeather(g: Game, cam: number): void {
    const t = g.animT;
    for (let i = 0; i < 40; i++) {
      const depth = 0.45 + (i % 3) * 0.25;
      const x = posMod(i * 37.7 + Math.sin(t * 0.6 + i) * 5, W);
      const y = posMod(t * (6 + (i % 5) * 2.2) + i * 53 - cam * depth, H + 8) - 4;
      this.fb.put(x, y);
    }
    if (g.phase === 'playing' && g.rider.speed > 150) {
      const n = Math.floor((g.rider.speed - 150) / 12) + 2;
      const frame = Math.floor(t * 30);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(hash2(frame, i) * W);
        const y = Math.floor(hash2(i, frame) * H);
        this.fb.put(x, y);
        this.fb.put(x, y + 1);
        this.fb.put(x, y + 2);
      }
    }
  }
}
