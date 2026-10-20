import type { Sfx } from './audio';
import { clearance, crossedY, NEAR_MISS_PX, riderCenter, testObstacle } from './collision';
import { EDGE, H, RIDER_SCREEN_Y, START_Y, W } from './config';
import type { Input } from './input';
import { createRider, stepRider, targetSpeed, type RiderState } from './rider';
import { hashSeed, normalizeSeed, randomSeedString } from './rng';
import {
  addGate,
  addNearMiss,
  addStar,
  createScore,
  distanceMeters,
  totalScore,
  type ScoreState,
} from './score';
import { Spawner } from './world/spawner';
import type { Gate, Obstacle, Pickup } from './world/types';

export type Phase = 'title' | 'playing' | 'paused' | 'crashed' | 'over';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export interface Toast {
  text: string;
  ttl: number;
  max: number;
}

/** Seconds of tumbling before the game over panel appears. */
export const CRASH_TIME = 1.25;
/** Ignore restart presses for this long after the game over panel appears. */
const RESTART_GUARD = 0.5;
const PICKUP_RADIUS = 7;
const TRAIL_SPACING = 1.5;
const TRAIL_MAX = 400;

export interface GameDeps {
  best: number;
  input: Input;
  sfx: Sfx;
  reducedMotion: () => boolean;
  saveBest: (score: number) => void;
  onSeed?: (seed: string) => void;
  announce?: (text: string) => void;
}

/** All game state plus the rules that advance it. Rendering only reads from it. */
export class Game {
  phase: Phase = 'title';
  seed = '';
  best: number;
  newBest = false;

  spawner!: Spawner;
  rider: RiderState = createRider();
  score: ScoreState = createScore();
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  gates: Gate[] = [];
  trail: Array<{ x: number; y: number }> = [];
  particles: Particle[] = [];
  toasts: Toast[] = [];

  camY = 0;
  /** Seconds since the page loaded that the world has been animating (stops while paused). */
  animT = 0;
  /** Seconds of actual riding in this run. */
  runTime = 0;
  /** Remaining screen shake in seconds. */
  shake = 0;
  crashT = 0;
  /** Direction the rider was heading when they crashed. */
  crashFace: 1 | -1 = -1;
  overAt = 0;
  /** Deepest y reached, so distance never shrinks when the rider recoils from a crash. */
  maxY = START_Y;

  private crashVx = 0;
  private crashVy = 0;

  constructor(
    private readonly deps: GameDeps,
    initialSeed?: string | null,
  ) {
    this.best = deps.best;
    this.newRun(normalizeSeed(initialSeed) ?? randomSeedString());
  }

  get distM(): number {
    return distanceMeters(this.maxY);
  }

  get scoreValue(): number {
    return totalScore(this.distM, this.score);
  }

  /** Camera y snapped to a whole pixel, so the scene scrolls in crisp one pixel steps. */
  get camYi(): number {
    return Math.round(this.camY);
  }

  get reduced(): boolean {
    return this.deps.reducedMotion();
  }

  /** Reset the world for a seed and wait on the title screen (or go straight in if `play`). */
  newRun(seed: string, play = false): void {
    this.seed = seed;
    this.deps.onSeed?.(seed);
    this.spawner = new Spawner(hashSeed(seed));
    this.rider = createRider();
    this.score = createScore();
    this.obstacles = [];
    this.pickups = [];
    this.gates = [];
    this.trail = [];
    this.particles = [];
    this.toasts = [];
    this.camY = this.rider.y - RIDER_SCREEN_Y;
    this.runTime = 0;
    this.shake = 0;
    this.crashT = 0;
    this.maxY = START_Y;
    this.newBest = false;
    this.phase = 'title';
    this.spawn();
    if (play) this.begin();
  }

  begin(): void {
    if (this.phase !== 'title') return;
    this.phase = 'playing';
    this.rider.speed = 30;
    this.deps.sfx.start();
    this.deps.announce?.(`Run started. Seed ${this.seed}.`);
  }

  update(dt: number): void {
    this.handleActions();
    if (this.phase !== 'paused') this.animT += dt;
    switch (this.phase) {
      case 'playing':
        this.stepPlaying(dt);
        break;
      case 'crashed':
        this.stepCrash(dt);
        break;
      default:
        break;
    }
    if (this.phase !== 'paused') this.stepEffects(dt);
    const r = this.rider;
    this.deps.sfx.ride(r.speed, r.hv, r.hx, this.phase === 'playing');
  }

  /** Pause when the page loses focus so a run never plays on while hidden. */
  autoPause(): void {
    if (this.phase === 'playing') this.togglePause();
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.deps.input.releaseAll();
      this.deps.announce?.('Paused.');
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.deps.announce?.('Resumed.');
    }
  }

  private handleActions(): void {
    for (const action of this.deps.input.drain()) {
      switch (action) {
        case 'mute': {
          const muted = this.deps.sfx.toggle();
          this.deps.announce?.(muted ? 'Sound off.' : 'Sound on.');
          break;
        }
        case 'pause':
          this.togglePause();
          break;
        case 'start':
          if (this.phase === 'title') this.begin();
          else if (this.phase === 'paused') this.togglePause();
          else if (this.phase === 'over' && this.animT - this.overAt > RESTART_GUARD) {
            this.newRun(randomSeedString(), true);
          }
          break;
        case 'retry':
          if (this.phase !== 'title') this.newRun(this.seed, true);
          break;
      }
    }
  }

  private spawn(): void {
    const batch = this.spawner.advance(this.camY + H + 70);
    if (batch.obstacles.length > 0) {
      this.obstacles.push(...batch.obstacles);
      this.obstacles.sort((a, b) => a.y - b.y);
    }
    this.pickups.push(...batch.pickups);
    this.gates.push(...batch.gates);
  }

  private stepPlaying(dt: number): void {
    const r = this.rider;
    const prev = riderCenter(r);
    stepRider(r, this.deps.input.steer(), dt, targetSpeed(this.distM));
    this.maxY = Math.max(this.maxY, r.y);
    this.camY = Math.max(this.camY, r.y - RIDER_SCREEN_Y);
    this.runTime += dt;
    this.spawn();
    this.recordTrail();

    const c = riderCenter(r);
    for (const o of this.obstacles) {
      if (o.y < r.y - 30) continue;
      if (o.y > r.y + 50) break;
      const hit = testObstacle(r, o);
      if (hit === 'crash') {
        this.startCrash(o);
        return;
      }
      if (hit === 'slow' && !o.touched) {
        o.touched = true;
        r.speed = Math.max(28, r.speed * 0.55);
        this.burst(r.x, r.y + 8, 8, 40, 0.5);
        this.deps.sfx.bush();
      }
      if (!o.judged && crossedY(prev.y, c.y, o.y)) {
        o.judged = true;
        const gap = clearance(r, o);
        if (gap !== null && gap <= NEAR_MISS_PX) this.awardNearMiss();
      }
    }

    for (const p of this.pickups) {
      if (p.taken || Math.abs(p.y - c.y) > PICKUP_RADIUS) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) < PICKUP_RADIUS) {
        p.taken = true;
        addStar(this.score);
        this.burst(p.x, p.y, 5, 22, 0.35);
        this.deps.sfx.pickup();
      }
    }

    for (const g of this.gates) {
      if (g.passed || !crossedY(prev.y, c.y, g.y)) continue;
      g.passed = true;
      if (Math.abs(r.x - g.x) < g.half) {
        g.success = true;
        const pts = addGate(this.score);
        this.toast(`CHECKPOINT +${pts}`, 1.4);
        this.deps.sfx.gate();
      }
    }

    this.cull();
  }

  private awardNearMiss(): void {
    const pts = addNearMiss(this.score, this.runTime);
    const combo = this.score.combo;
    this.toast(combo > 1 ? `CLOSE X${combo} +${pts}` : `CLOSE! +${pts}`, 1);
    this.deps.sfx.nearMiss();
  }

  private recordTrail(): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.rider.x - last.x, this.rider.y - last.y) >= TRAIL_SPACING) {
      this.trail.push({ x: this.rider.x, y: this.rider.y });
      if (this.trail.length > TRAIL_MAX) this.trail.shift();
    }
  }

  private cull(): void {
    const top = this.camY - 12;
    let i = 0;
    while (i < this.obstacles.length && (this.obstacles[i]?.y ?? 0) < top) i++;
    if (i > 0) this.obstacles.splice(0, i);
    this.pickups = this.pickups.filter((p) => p.y > top && !p.taken);
    this.gates = this.gates.filter((g) => g.y > top - 30);
    while (this.trail.length > 0 && (this.trail[0]?.y ?? 0) < top) this.trail.shift();
  }

  private startCrash(o: Obstacle): void {
    const r = this.rider;
    this.phase = 'crashed';
    this.crashT = 0;
    this.crashFace = r.face;
    const away = r.x < o.x ? -1 : 1;
    this.crashVx = away * 22 + r.hx * 20;
    this.crashVy = -48;
    r.speed = 0;
    this.burst(r.x, r.y + 8, 26, 70, 1.1);
    if (!this.reduced) this.shake = 0.45;
    this.deps.sfx.crash();
  }

  private stepCrash(dt: number): void {
    const r = this.rider;
    this.crashT += dt;
    r.x = Math.max(EDGE, Math.min(W - EDGE, r.x + this.crashVx * dt));
    r.y += this.crashVy * dt;
    const damp = Math.exp(-4.5 * dt);
    this.crashVx *= damp;
    this.crashVy *= damp;
    if (this.crashT >= CRASH_TIME) this.finish();
  }

  private finish(): void {
    this.phase = 'over';
    this.overAt = this.animT;
    const score = this.scoreValue;
    if (score > this.best) {
      this.best = score;
      this.newBest = score > 0;
      this.deps.saveBest(score);
    }
    this.deps.announce?.(
      `Wipeout. ${this.distM} metres, score ${score}${this.newBest ? ', a new best' : ''}.`,
    );
  }

  private burst(x: number, y: number, n: number, speed: number, life: number): void {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.7 - speed * 0.25,
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
      });
    }
  }

  private toast(text: string, ttl: number): void {
    this.toasts = [{ text, ttl, max: ttl }];
  }

  private stepEffects(dt: number): void {
    this.shake = Math.max(0, this.shake - dt);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      p.vx *= Math.exp(-2 * dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.toasts) t.ttl -= dt;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
  }
}
