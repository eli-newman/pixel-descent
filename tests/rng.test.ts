import { describe, expect, it } from 'vitest';
import { Rng, hash2, hashSeed, normalizeSeed, randomSeedString } from '../src/core/rng';

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(hashSeed('abc123'));
    const b = new Rng(hashSeed('abc123'));
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(hashSeed('abc123'));
    const b = new Rng(hashSeed('abc124'));
    expect(a.next()).not.toBe(b.next());
  });

  it('stays inside its ranges', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('hashes strings to a stable 32-bit value', () => {
    expect(hashSeed('pixel')).toBe(hashSeed('pixel'));
    expect(hashSeed('pixel')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('pixel')).toBeLessThan(2 ** 32);
  });

  it('hash2 is stateless and in [0, 1)', () => {
    expect(hash2(3, 9)).toBe(hash2(3, 9));
    expect(hash2(3, 9)).not.toBe(hash2(9, 3));
    const v = hash2(-5, 1234);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('makes and cleans seed strings', () => {
    expect(randomSeedString()).toMatch(/^[a-z0-9]{6}$/);
    expect(normalizeSeed('  Ab-C 12!! ')).toBe('abc12');
    expect(normalizeSeed('!!!')).toBeNull();
    expect(normalizeSeed(null)).toBeNull();
  });
});
