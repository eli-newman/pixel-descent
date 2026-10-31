import { describe, expect, it } from 'vitest';
import { Particles } from '../src/state/effects';

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
});
