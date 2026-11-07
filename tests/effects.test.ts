import { describe, expect, it } from 'vitest';
import { H, STEP, W } from '../src/core/config';
import { Framebuffer } from '../src/render/framebuffer';
import { COLOR } from '../src/render/palette';
import { SceneRenderer } from '../src/render/scene';
import { createRider, type RiderState } from '../src/sim/riderState';
import { CarveCloud, Particles, Puffs } from '../src/state/effects';
import { makeGame } from './helpers/fakes';

const half = (): number => 0.5;

describe('Particles', () => {
  it('never grows past its capacity', () => {
    const p = new Particles(4);
    p.jet(0, 0, 10, 20, 5, 1, half);
    expect(p.count).toBe(4);
  });

  it('spawns a jet around the point, with a life shortened by the random source', () => {
    const p = new Particles();
    p.jet(10, 20, 1, 30, 0, 2, () => 0.5);
    expect(p.x[0]).toBe(10);
    expect(p.y[0]).toBe(20);
    expect(p.max[0]).toBe(2);
    expect(p.life[0]).toBeCloseTo(1.6);
  });

  it('throws a jet upwards', () => {
    const p = new Particles();
    p.jet(0, 100, 1, 50, 0, 1, half);
    p.step(0.1);
    expect(p.y[0]).toBeLessThan(100);
  });

  it('pulls particles down with gravity', () => {
    const still = new Particles();
    still.jet(0, 0, 1, 0, 0, 10, half);
    still.step(1);
    expect(still.y[0]).toBeCloseTo(60);
  });

  it('drops dead particles and keeps the survivors in order', () => {
    const p = new Particles();
    p.jet(1, 0, 1, 0, 0, 0.1, half);
    p.jet(2, 0, 1, 0, 0, 10, half);
    p.step(0.2);
    expect(p.count).toBe(1);
    expect(p.x[0]).toBe(2);
    p.clear();
    expect(p.count).toBe(0);
  });

  it('leaves a grain on the snow exactly where a fleck comes down', () => {
    const p = new Particles();
    p.jet(30, 40, 1, 0, 0, 0.1, half);
    p.step(0.05);
    const x = p.x[0];
    const y = p.y[0];
    p.step(0.2);
    expect(p.count).toBe(0);
    expect(p.landedCount).toBe(1);
    expect(p.landedX[0]).toBe(x);
    expect(p.landedY[0]).toBe(y);
  });

  it('only leaves a grain for every other fleck, keeps a fixed number, and clears them for a new run', () => {
    const p = new Particles();
    for (let i = 0; i < 2000; i++) {
      p.jet(i, 0, 1, 0, 0, 0.01, half);
      p.step(0.02);
    }
    expect(p.landedCount).toBe(320);
    p.clear();
    expect(p.landedCount).toBe(0);
    p.jet(1, 0, 1, 0, 0, 0.01, half);
    p.jet(2, 0, 1, 0, 0, 0.01, half);
    p.step(0.02);
    expect(p.landedCount).toBe(1);
  });
});

describe('the carve cloud', () => {
  const carving = (speed: number, hv: number): RiderState => ({
    ...createRider(),
    x: 90,
    y: 1000,
    hx: 0.4,
    hv,
    speed,
  });
  /** Steps a held carve for `steps` steps, keeping the rider's speed and turn fixed. */
  const run = (r: RiderState, steps = 24): { puffs: Puffs; particles: Particles } => {
    const cloud = new CarveCloud();
    const puffs = new Puffs();
    const particles = new Particles();
    for (let i = 0; i < steps; i++) cloud.step(r, puffs, particles, half);
    return { puffs, particles };
  };

  it('throws nothing riding slowly, in the air or braking', () => {
    expect(run(carving(60, 4)).puffs.count).toBe(0);
    expect(run({ ...carving(250, 4), air: true }).puffs.count).toBe(0);
    expect(run({ ...carving(250, 4), brake: 1 }).puffs.count).toBe(0);
    expect(CarveCloud.wake({ ...carving(250, 0), air: true })).toBe(0);
  });

  it('leaves a wake of powder behind a board running straight at speed, to both sides', () => {
    const straight = { ...carving(250, 0), hx: 0 };
    expect(run({ ...straight, speed: 90 }).puffs.count).toBe(0);
    expect(CarveCloud.wake({ ...straight, speed: 150 })).toBeLessThan(CarveCloud.wake(straight));
    // a wake, not a carve: smaller than a hard turn's cloud
    expect(CarveCloud.wake(straight)).toBeLessThan(CarveCloud.power(carving(250, 4), 0));
    let i = 0;
    const flip = (): number => [0.2, 0.7, 0.5][i++ % 3] ?? 0.5;
    const cloud = new CarveCloud();
    const puffs = new Puffs();
    for (let k = 0; k < 120; k++) cloud.step(straight, puffs, new Particles(), flip);
    expect(puffs.count).toBeGreaterThan(10);
    const xs = Array.from(puffs.x.slice(0, puffs.count));
    puffs.step(0.3);
    const moved = Array.from(puffs.x.slice(0, puffs.count)).map((x, k) => x - (xs[k] ?? 0));
    expect(moved.some((d) => d < -1)).toBe(true);
    expect(moved.some((d) => d > 1)).toBe(true);
  });

  it('throws a cloud out of a hard turn at speed, bigger the faster and harder the turn', () => {
    const soft = CarveCloud.power(carving(120, 1.5), 0);
    const hard = CarveCloud.power(carving(250, 4), 0);
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
    // scrubbing speed off on the edge throws snow too
    expect(CarveCloud.power(carving(200, 0.5), 250)).toBeGreaterThan(
      CarveCloud.power(carving(200, 0.5), 0),
    );
    expect(run(carving(250, 4)).puffs.count).toBeGreaterThan(run(carving(120, 1.5)).puffs.count);
  });

  it('sends the cloud out of the turn and leaves it behind the rider', () => {
    for (const hv of [4, -4]) {
      const r = carving(250, hv);
      const { puffs } = run(r, 2);
      expect(puffs.count).toBeGreaterThan(0);
      const x0 = puffs.x[0] ?? 0;
      const y0 = puffs.y[0] ?? 0;
      puffs.step(0.2);
      // turning right (hv > 0) throws the snow left, and the other way round
      expect(Math.sign((puffs.x[0] ?? 0) - x0 - r.hx * r.speed * 0.3 * 0.2)).toBe(-Math.sign(hv));
      // the rider moves on far further than the cloud does
      const hy = Math.sqrt(1 - r.hx * r.hx);
      expect((puffs.y[0] ?? 0) - y0).toBeLessThan(hy * r.speed * 0.2 * 0.5);
    }
  });

  it('grows each puff and thins it out, then drops it, and never grows past its capacity', () => {
    const p = new Puffs();
    p.add(0, 0, 0, 0, 8, 1, 1);
    p.step(0.1);
    const r1 = p.r[0] ?? 0;
    const f1 = p.fill[0] ?? 0;
    p.step(0.5);
    expect(p.r[0]).toBeGreaterThan(r1);
    expect(p.fill[0]).toBeLessThan(f1);
    p.step(0.5);
    expect(p.count).toBe(0);
    for (let i = 0; i < 1000; i++) p.add(0, 0, 0, 0, 4, 1, 1);
    expect(p.count).toBe(160);
  });

  it('draws a cloud in the slope powder colours, and starts each run without one', () => {
    const { game, input } = makeGame('cloud');
    game.settings.color = true;
    input.push('start');
    for (let i = 0; i < 6; i++) game.update(STEP);
    const r = game.sim.rider;
    game.puffs.add(r.x - 30, r.y - 40, 0, 0, 6, 10, 1);
    game.puffs.step(0.5);
    const scene = new SceneRenderer(new Framebuffer(W, H));
    const before = new Uint32Array(scene.render(game).data.buffer).slice();
    // Render the same puff with no cloud, to see which pixels it painted.
    const saved = game.puffs.count;
    game.puffs.count = 0;
    const plain = new Uint32Array(scene.render(game).data.buffer).slice();
    game.puffs.count = saved;
    const colors = new Set<number>();
    for (let i = 0; i < before.length; i++) if (before[i] !== plain[i]) colors.add(before[i] ?? 0);
    expect(colors.size).toBeGreaterThan(0);
    expect([...colors].every((c) => c === COLOR.powder || c === COLOR.spray)).toBe(true);
    game.newRun('cloud-2');
    expect(game.puffs.count).toBe(0);
  });
});
