import { BOARD_LEN } from '../core/config';
import { poseOf } from '../sim/pose';
import { type RiderState } from '../sim/riderState';

/** Only every other fleck leaves a grain behind, so a long skid dusts the snow without burying it. */
const LAND_EVERY = 2;
/** Grains kept on the snow. The oldest are overwritten, and by then the camera has usually moved past them. */
const LANDED_CAPACITY = 320;

/** Fixed size particle pool: jets never allocate, and stepping compacts in place. Flecks that come down stay on the snow. */
export class Particles {
  readonly x: Float32Array;
  readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  count = 0;
  readonly landedX = new Float32Array(LANDED_CAPACITY);
  readonly landedY = new Float32Array(LANDED_CAPACITY);
  landedCount = 0;
  private landedHead = 0;
  private falling = 0;

  constructor(readonly capacity = 256) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
  }

  clear(): void {
    this.count = 0;
    this.landedCount = 0;
    this.landedHead = 0;
    this.falling = 0;
  }

  /**
   * Throw `n` flecks mostly straight up (towards the top of the screen) with a sideways spread,
   * like a plume of powder. Gravity pulls them back down.
   */
  jet(
    x: number,
    y: number,
    n: number,
    up: number,
    spread: number,
    life: number,
    rand: () => number,
    carry = 0,
  ): void {
    for (let i = 0; i < n && this.count < this.capacity; i++) {
      const k = this.count++;
      this.x[k] = x + (rand() - 0.5) * 6;
      this.y[k] = y + (rand() - 0.5) * 3;
      this.vx[k] = (rand() - 0.5) * 2 * spread;
      this.vy[k] = carry - up * (0.55 + rand() * 0.6);
      this.max[k] = life;
      this.life[k] = life * (0.6 + rand() * 0.4);
    }
  }

  step(dt: number): void {
    const drag = Math.exp(-2 * dt);
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const life = (this.life[i] ?? 0) - dt;
      if (life <= 0) {
        this.land(this.x[i] ?? 0, this.y[i] ?? 0);
        continue;
      }
      const vy = (this.vy[i] ?? 0) + 60 * dt;
      const vx = (this.vx[i] ?? 0) * drag;
      this.x[w] = (this.x[i] ?? 0) + vx * dt;
      this.y[w] = (this.y[i] ?? 0) + vy * dt;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.life[w] = life;
      this.max[w] = this.max[i] ?? 0;
      w++;
    }
    this.count = w;
  }

  private land(x: number, y: number): void {
    if (this.falling++ % LAND_EVERY !== 0) return;
    this.landedX[this.landedHead] = x;
    this.landedY[this.landedHead] = y;
    this.landedHead = (this.landedHead + 1) % LANDED_CAPACITY;
    this.landedCount = Math.min(LANDED_CAPACITY, this.landedCount + 1);
  }
}

/** Plowing sideways skids the board's flat base through the snow. The plume scales with speed and builds the longer the skid is held. */
export class BrakeSpray {
  private tick = 0;
  /** Seconds the current skid has been held; the plume builds with it. */
  private skid = 0;

  reset(): void {
    this.skid = 0;
  }

  step(r: RiderState, particles: Particles, rand: () => number): void {
    const dt = 1 / 120;
    const skidding = r.brake >= 0.35 && !r.air && r.speed >= 36;
    this.skid = skidding ? this.skid + dt : Math.max(0, this.skid - 3 * dt);
    if (!skidding) return;
    // Even a cruising skid should read clearly, so speed only scales it from 55% up.
    const f = 0.55 + 0.45 * Math.min(1, Math.max(0, (r.speed - 36) / 150));
    const build = Math.min(1, 0.4 + this.skid / 0.5);
    this.tick++;
    if (this.tick % 3 !== 0) return;
    const power = f * build;
    // Particles live in world space, so they inherit the rider's downhill speed; otherwise they just fall behind as a trail.
    const n = Math.round(1 + 2 * power);
    const carry = r.speed;
    // The board is plowed sideways, so the powder is shoved up off its leading (nose) edge, not the tail.
    const pose = poseOf(r, r.x, r.y, 0);
    const nx = r.x + pose.nx * BOARD_LEN;
    const ny = r.y + pose.ny * BOARD_LEN;
    const mx = r.x + pose.nx * BOARD_LEN * 0.5;
    const my = r.y + pose.ny * BOARD_LEN * 0.5;
    particles.jet(nx, ny - 1, n, 70 + 80 * power, 22 + 8 * power, 0.75, rand, carry);
    particles.jet(mx, my - 1, n >> 1, 60 + 50 * power, 16, 0.6, rand, carry);
  }
}

/** Puffs alive at once. A long hard carve keeps about 100 going. */
const PUFF_CAPACITY = 160;
/** Below this speed (px/s) a turn throws no cloud: it takes speed to dump snow out of the edge. */
const CLOUD_MIN_SPEED = 70;
/** Speed above `CLOUD_MIN_SPEED` at which the cloud is at full size. */
const CLOUD_SPEED_RANGE = 130;
/** Heading rate (|hv|) of a full hard turn, and speed scrubbed per second by a full carve. */
const CLOUD_TURN_RATE = 4;
const CLOUD_SCRUB = 250;

/**
 * Soft round clouds of powder. Each puff grows and thins out over its life, and the renderer dithers it
 * against the world grid, so a cloud drifts and fades without flickering.
 */
export class Puffs {
  readonly x = new Float32Array(PUFF_CAPACITY);
  readonly y = new Float32Array(PUFF_CAPACITY);
  /** Radius in px and how much of the disc is filled (0 to 1), both updated every step. */
  readonly r = new Float32Array(PUFF_CAPACITY);
  readonly fill = new Float32Array(PUFF_CAPACITY);
  private readonly vx = new Float32Array(PUFF_CAPACITY);
  private readonly vy = new Float32Array(PUFF_CAPACITY);
  private readonly age = new Float32Array(PUFF_CAPACITY);
  private readonly life = new Float32Array(PUFF_CAPACITY);
  private readonly size = new Float32Array(PUFF_CAPACITY);
  private readonly power = new Float32Array(PUFF_CAPACITY);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  /** Add a puff moving at (vx, vy) px/s that grows to `size` px across `life` seconds. */
  add(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    power: number,
  ): void {
    if (this.count >= PUFF_CAPACITY) return;
    const k = this.count++;
    this.x[k] = x;
    this.y[k] = y;
    this.vx[k] = vx;
    this.vy[k] = vy;
    this.age[k] = 0;
    this.life[k] = life;
    this.size[k] = size;
    this.power[k] = power;
    this.r[k] = 1;
    this.fill[k] = power;
  }

  step(dt: number): void {
    // Snow thrown into the air slows quickly and then hangs.
    const drag = Math.exp(-3.5 * dt);
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] ?? 0) + dt;
      const life = this.life[i] ?? 0;
      if (age >= life) continue;
      const t = age / life;
      const vx = (this.vx[i] ?? 0) * drag;
      const vy = (this.vy[i] ?? 0) * drag;
      this.x[w] = (this.x[i] ?? 0) + vx * dt;
      this.y[w] = (this.y[i] ?? 0) + vy * dt;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.age[w] = age;
      this.life[w] = life;
      this.size[w] = this.size[i] ?? 0;
      this.power[w] = this.power[i] ?? 0;
      // Grows fast at first, then billows slowly; thins out as it goes.
      this.r[w] = 1 + ((this.size[w] ?? 0) - 1) * Math.sqrt(t);
      this.fill[w] = (this.power[w] ?? 0) * (1 - t) * (1 - t * 0.3);
      w++;
    }
    this.count = w;
  }
}

/**
 * A hard carve at speed throws a cloud of powder off the board's edge, out of the turn and back up the
 * hill behind the rider, like the spray behind a snowboarder in a fast turn. It grows with speed, with how
 * hard the turn is, and with how much speed the edge is scrubbing. Braking has its own spray.
 */
export class CarveCloud {
  private tick = 0;
  private lastSpeed = 0;

  reset(): void {
    this.tick = 0;
    this.lastSpeed = 0;
  }

  /** How hard the rider is carving right now, 0 to 1. */
  static power(r: RiderState, scrubbed: number): number {
    if (r.air || r.brake >= 0.35 || r.speed < CLOUD_MIN_SPEED) return 0;
    const fast = Math.min(1, (r.speed - CLOUD_MIN_SPEED) / CLOUD_SPEED_RANGE);
    const turn = Math.min(1, Math.abs(r.hv) / CLOUD_TURN_RATE);
    const scrub = Math.min(1, Math.max(0, scrubbed) / CLOUD_SCRUB);
    return Math.min(1, fast * (0.35 + 0.65 * turn) * Math.max(turn, scrub) * 1.6);
  }

  step(r: RiderState, puffs: Puffs, particles: Particles, rand: () => number): void {
    const dt = 1 / 120;
    const scrubbed = (this.lastSpeed - r.speed) / dt;
    this.lastSpeed = r.speed;
    const power = CarveCloud.power(r, scrubbed);
    this.tick++;
    if (power < 0.12 || this.tick % 2 !== 0) return;
    // The edge digs in on the inside of the turn and throws the snow out the other way.
    const out = r.hv > 0 ? -1 : r.hv < 0 ? 1 : -Math.sign(r.hx) || 1;
    const hy = Math.sqrt(Math.max(0, 1 - r.hx * r.hx));
    // World velocity: a share of the rider's, so the cloud falls behind him, plus the throw out of the turn.
    const keep = 0.3;
    const throwOut = 40 + 70 * power;
    const n = 1 + Math.round(power * 1.4);
    for (let k = 0; k < n; k++) {
      const vx = r.hx * r.speed * keep + out * throwOut * (0.6 + rand() * 0.6);
      const vy = hy * r.speed * keep - (10 + 30 * power) * rand();
      puffs.add(
        r.x + out * 2 + (rand() - 0.5) * 3,
        r.y - 1 + (rand() - 0.5) * 3,
        vx,
        vy,
        3 + 6 * power * (0.7 + rand() * 0.3),
        0.55 + 0.6 * power,
        0.55 + 0.45 * power,
      );
    }
    // A few bright flecks fly out of the cloud.
    if (power > 0.3)
      particles.jet(r.x + out * 3, r.y - 1, 1, 50 + 60 * power, 18, 0.5, rand, r.speed * 0.5);
  }
}
