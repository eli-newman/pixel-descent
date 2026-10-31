import { describe, expect, it } from 'vitest';
import { detExp } from '../src/core/detMath';

describe('detExp', () => {
  it('matches Math.exp to within a few parts in 10^15 over the range the course uses', () => {
    for (let x = -60; x <= 5; x += 0.0137) {
      const want = Math.exp(x);
      expect(Math.abs(detExp(x) - want) / want).toBeLessThan(4e-16);
    }
  });

  it('gets the fixed points and the far ends right', () => {
    expect(detExp(0)).toBe(1);
    expect(detExp(1000)).toBe(Infinity);
    expect(detExp(-1000)).toBe(0);
    expect(detExp(-700)).toBeGreaterThan(0);
  });

  it('gives the exact bits of a reference value, so a course cannot drift', () => {
    expect(detExp(-1)).toBe(0.36787944117144233);
    expect(detExp(-2.5)).toBe(0.0820849986238988);
  });
});
