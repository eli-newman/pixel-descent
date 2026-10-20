/** Hash an arbitrary string into a 32-bit unsigned seed (FNV-1a with a final avalanche mix). */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small, fast, seedable PRNG (mulberry32). The same seed always yields the same sequence. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** Uniform integer in [a, b], both inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Stateless hash of two integers to a float in [0, 1), for cosmetic scatter that needs no state. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A short, readable, shareable seed such as "k3m9qa". Only place that uses Math.random. */
export function randomSeedString(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  return s;
}

/** Clean up a seed typed or pasted by a user. Returns null when nothing usable is left. */
export function normalizeSeed(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  return cleaned.length > 0 ? cleaned : null;
}
