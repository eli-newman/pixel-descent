import { Rng } from '../rng';
import type { ObstacleKind } from '../world/types';

type Pt = readonly [number, number];

/** A set of integer points, so sprites can be carved with "put" and "del" like the source art. */
class Grid {
  private readonly m = new Map<number, Pt>();
  private static key(x: number, y: number): number {
    return (x + 512) * 1024 + (y + 512);
  }
  put(x: number, y: number): void {
    this.m.set(Grid.key(x, y), [x, y]);
  }
  del(x: number, y: number): void {
    this.m.delete(Grid.key(x, y));
  }
  has(x: number, y: number): boolean {
    return this.m.has(Grid.key(x, y));
  }
  pts(): Pt[] {
    return [...this.m.values()];
  }
}

function makePine(h: number): Pt[] {
  const g = new Grid();
  const N = h < 14 ? 2 : h < 24 ? 3 : h < 34 ? 4 : 5;
  const rows = new Map<number, number>();
  const wMax = Math.round(3 + h * 0.27);
  const tierH = Math.round((h / N) * 1.7);
  const gap = (h - 2 - tierH) / (N - 1);
  for (let t = 0; t < N; t++) {
    const top = Math.round(-h + t * gap);
    const wt = Math.max(2, Math.round((wMax * (t + 1)) / N));
    for (let r = 0; r <= tierH; r++) {
      const ww = Math.round((wt * (r + 1)) / (tierH + 1));
      rows.set(top + r, Math.max(rows.get(top + r) ?? 0, ww));
    }
  }
  for (const [y, ww] of rows) for (let x = -ww; x <= ww; x++) g.put(x, y);
  // volume: stipple the shaded (right) flank, keep a bright rim
  for (const [y, ww] of rows) {
    for (let x = Math.ceil(ww * 0.55); x <= ww; x++) if ((x + y) % 3 === 0) g.del(x, y);
  }
  // snow clumps on tier edges
  for (const [y, ww] of rows) {
    const below = rows.get(y + 1);
    if (below !== undefined && below > ww + 1) g.put(-ww - 1, y + 1);
  }
  for (let y = -2; y <= 1; y++) {
    g.put(0, y);
    g.put(1, y);
  } // trunk
  return g.pts();
}

function makeBush(): Pt[] {
  const g = new Grid();
  const w = 9;
  const h = 7;
  for (let y = 0; y < h; y++) {
    const k = Math.sqrt(1 - Math.pow((y - h) / h, 2));
    const ww = Math.round(w * k);
    for (let x = -ww; x <= ww; x++) g.put(x, y - h + 1);
  }
  for (let y = -h + 3; y <= 0; y++) {
    for (let x = -w; x <= w; x++) if (g.has(x, y) && (x + y) % 3 === 0 && x > 0) g.del(x, y);
  }
  return g.pts();
}

function makeDead(h: number): Pt[] {
  const g = new Grid();
  for (let y = -h; y <= 0; y++) g.put(0, y);
  const branches: Array<[number, number]> = [
    [-h * 0.55, -1],
    [-h * 0.7, 1],
    [-h * 0.35, 1],
  ];
  branches.forEach(([y, d], i) => {
    const len = 3 + (i % 2) * 2;
    for (let k = 1; k <= len; k++) g.put(d * k, Math.round(y - k * 0.8));
  });
  g.put(0, 1);
  g.put(-1, 0);
  g.put(1, 0);
  return g.pts();
}

function makeRock(size: number, rng: Rng): Pt[] {
  const g = new Grid();
  const w = size;
  const h = Math.max(4, Math.round(size * 0.72));
  const poly: Array<[number, number]> = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i * Math.PI) / (n - 1);
    const jr = 0.88 + rng.next() * 0.2;
    poly.push([Math.cos(a) * w * 0.5 * jr, Math.sin(a) * h * jr]);
  }
  poly.push([w / 2, 0]);
  poly.unshift([-w / 2, 0]);
  for (let y = -h - 2; y <= 0; y++) {
    for (let x = -w; x <= w; x++) {
      // point in polygon
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i] ?? [0, 0];
        const [xj, yj] = poly[j] ?? [0, 0];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) g.put(x, y);
    }
  }
  // facets: diagonal crack lines and a shaded right/lower flank
  const cx = Math.round(-w * 0.15);
  for (const [x, y] of g.pts()) {
    const rel = x - cx;
    if (
      size >= 9 &&
      (rel + (y + h) === Math.round(w * 0.35) ||
        (rel - (y + h) === -Math.round(w * 0.5) && y > -h * 0.8))
    ) {
      g.del(x, y);
    }
    if (size >= 11 && x > w * 0.22 && y > -h * 0.4 && (x + y) % 3 === 0) g.del(x, y);
  }
  return g.pts();
}

export interface Sprite {
  /** Flat x,y pairs relative to the sprite's base centre. */
  pts: Int16Array;
  /** Flat x,y pairs of the cast shadow (light from the upper left), to be dithered when drawn. */
  shadow: Int16Array;
}

function flatten(points: Iterable<Pt>): Int16Array {
  const out: number[] = [];
  for (const [x, y] of points) out.push(x, y);
  return Int16Array.from(out);
}

function castShadow(pts: readonly Pt[]): Int16Array {
  const seen = new Map<number, Pt>();
  for (const [dx, dy] of pts) {
    const h = -dy;
    if (h < -1) continue;
    const sx = Math.round(dx + Math.max(0, h) * 0.85 + 1);
    const sy = Math.round(1 + Math.max(0, h) * 0.28);
    seen.set((sx + 512) * 1024 + (sy + 512), [sx, sy]);
  }
  return flatten(seen.values());
}

const cache = new Map<number, Sprite>();
const KIND_INDEX: Record<ObstacleKind, number> = { tree: 0, bush: 1, dead: 2, rock: 3 };

/** Build (or fetch from cache) the sprite for an obstacle. Rocks vary by `variant`. */
export function getSprite(kind: ObstacleKind, size: number, variant: number): Sprite {
  const key = (KIND_INDEX[kind] * 1000 + size) * 8 + (kind === 'rock' ? variant & 7 : 0);
  let sprite = cache.get(key);
  if (!sprite) {
    let pts: Pt[];
    switch (kind) {
      case 'tree':
        pts = makePine(size);
        break;
      case 'bush':
        pts = makeBush();
        break;
      case 'dead':
        pts = makeDead(size);
        break;
      case 'rock':
        pts = makeRock(size, new Rng(size * 131 + variant * 17 + 5));
        break;
    }
    sprite = { pts: flatten(pts), shadow: castShadow(pts) };
    cache.set(key, sprite);
  }
  return sprite;
}
