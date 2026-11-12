import { hash2, Rng } from '../core/rng';
import { C } from './palette';
import { isPebble } from '../sim/collision';
import type { ObstacleKind } from '../sim/types';

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

/** A pine's tiers as the half width of every row, keyed by row (y up from the base is negative). */
function pineRows(h: number): Map<number, number> {
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
  return rows;
}

function makePine(h: number): Pt[] {
  const g = new Grid();
  const rows = pineRows(h);
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

const BUSH_PUFFS: ReadonlyArray<readonly [number, number, number]> = [
  [-5, -4, 3.3],
  [0, -5, 3.4],
  [5, -4, 3.3],
];

function inBush(x: number, y: number): boolean {
  return (
    y <= 0 &&
    ((y >= -3 && Math.abs(x) <= (y === 0 ? 6 : 7)) ||
      BUSH_PUFFS.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r))
  );
}

/** A dark leaf hole: staggered inside the outline, so the bush reads as foliage and not as stone. */
function isLeafHole(x: number, y: number): boolean {
  const rim = !inBush(x - 1, y) || !inBush(x + 1, y) || !inBush(x, y - 1) || y === 0;
  return !rim && y % 2 !== 0 && (x + (y % 4 === -1 ? 0 : 2) + 16) % 4 === 0;
}

/**
 * A shrub, not a stone: a row of round puffs that leave notches along a bumpy top, with dark leaf
 * holes all over it. A bush slows you instead of stopping you, so it must never share a rock's smooth,
 * cracked silhouette.
 */
function makeBush(): Pt[] {
  const g = new Grid();
  for (let y = -10; y <= 0; y++) {
    for (let x = -9; x <= 9; x++) if (inBush(x, y) && !isLeafHole(x, y)) g.put(x, y);
  }
  return g.pts();
}

/** A pebble lies flat in the snow: a tiny stone two pixels tall. Pebbles never collide, so they must not look like a rock. */
function makePebble(size: number): Pt[] {
  const g = new Grid();
  const hw = Math.max(1, Math.floor((size - 3) / 2));
  for (let x = -hw; x <= hw; x++) g.put(x, 0);
  for (let x = -hw + 1; x < hw; x++) g.put(x, -1);
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

/**
 * A rock: an angular outline, then facets carved out of it (diagonal cracks and a shaded right and lower
 * flank). Returns the solid outline and the carved points; black and white leaves the carved points open,
 * colour paints them dark.
 */
function rockShape(size: number, rng: Rng): { solid: Pt[]; carved: Pt[] } {
  const g = new Grid();
  const w = size;
  const h = Math.max(4, Math.round(size * 0.72));
  const poly: Array<[number, number]> = [];
  const n = 6;
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
  const solid = g.pts();
  const carved: Pt[] = [];
  for (const [x, y] of solid) {
    const rel = x - cx;
    if (
      size >= 9 &&
      (rel + (y + h) === Math.round(w * 0.35) ||
        (rel - (y + h) === -Math.round(w * 0.5) && y > -h * 0.8))
    ) {
      carved.push([x, y]);
    } else if (size >= 11 && x > w * 0.22 && y > -h * 0.4 && (x + y) % 3 === 0) carved.push([x, y]);
  }
  return { solid, carved };
}

function makeRock(size: number, rng: Rng): Pt[] {
  const { solid, carved } = rockShape(size, rng);
  const g = new Grid();
  for (const [x, y] of solid) g.put(x, y);
  for (const [x, y] of carved) g.del(x, y);
  return g.pts();
}

export interface Sprite {
  /** Flat x,y pairs relative to the sprite's base centre. */
  pts: Int16Array;
  /** Flat x,y pairs of the cast shadow (light from the upper left), to be dithered when drawn. */
  shadow: Int16Array;
  /** The highest row of the sprite (most negative y), where a label can sit above it. */
  top: number;
  /** The lowest row of the sprite or its shadow, which falls below the base, for culling at the screen's top edge. */
  bottom: number;
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
        pts = isPebble(kind, size)
          ? makePebble(size)
          : makeRock(size, new Rng(size * 131 + variant * 17 + 5));
        break;
    }
    // A pebble lies flat, so it casts no shadow: only things that stand up out of the snow do.
    const flat = isPebble(kind, size);
    const shadow = flat ? new Int16Array(0) : castShadow(pts);
    sprite = {
      pts: flatten(pts),
      shadow,
      top: Math.min(0, ...pts.map(([, y]) => y)),
      bottom: Math.max(0, ...pts.map(([, y]) => y), ...shadow.filter((_, i) => i % 2 === 1)),
    };
    cache.set(key, sprite);
  }
  return sprite;
}

// ---------------------------------------------------------------------------------------------
// Colour mode. The same shapes as above, so hitboxes, shadows and the visual language stay the same, painted:
// dark green pines with snow on every tier and a brown trunk and branches, rocks in dark grey or dark brown
// with texture and a snow cap, green bushes, brown dead trees with snow along the branches.

/** A sprite with a colour per point: `pts` holds x,y pairs, `colors` one colour per pair. */
export interface ColorSprite {
  pts: Int16Array;
  colors: Uint32Array;
}

/** Points with a colour each, painted in order: later paint wins. */
class Paint {
  private readonly m = new Map<number, readonly [number, number, number]>();
  set(x: number, y: number, c: number): void {
    this.m.set((x + 512) * 1024 + (y + 512), [x, y, c]);
  }
  private has(x: number, y: number): boolean {
    return this.m.has((x + 512) * 1024 + (y + 512));
  }
  /**
   * Snow on a sprite is as white as the slope, so where it meets open snow it would melt into it and eat the
   * silhouette. `edge` outlines every white pixel on the sides facing open slope, keeping the shape whole.
   */
  build(edge: number): ColorSprite {
    const rim: Array<readonly [number, number]> = [];
    for (const [x, y, c] of this.m.values()) {
      if (c !== C.white) continue;
      for (const [dx, dy] of SIDES) if (!this.has(x + dx, y + dy)) rim.push([x + dx, y + dy]);
    }
    for (const [x, y] of rim) this.set(x, y, edge);
    const v = [...this.m.values()];
    return {
      pts: Int16Array.from(v.flatMap(([x, y]) => [x, y])),
      colors: Uint32Array.from(v.map(([, , c]) => c)),
    };
  }
}

const SIDES: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
];

/** A fixed hash in [0, 1) per pixel, so textures belong to the sprite and never shimmer. */
function speck(x: number, y: number, k: number): number {
  return hash2(x * 31 + k * 977, y * 17 + k);
}

function colorPine(h: number): ColorSprite {
  const rows = pineRows(h);
  const inTree = (x: number, y: number): boolean => Math.abs(x) <= (rows.get(y) ?? -1);
  const p = new Paint();
  // the trunk first, so the needles cover it everywhere but under the lowest tier
  for (let y = -3; y <= 1; y++) {
    p.set(0, y, C.bark);
    p.set(1, y, C.barkDark);
  }
  for (const [y, ww] of rows) {
    for (let x = -ww; x <= ww; x++) {
      const shaded = x >= Math.ceil(ww * 0.55);
      let c: number = shaded && (x + y) % 3 === 0 ? C.pineShade : C.pine;
      if (x <= -ww + 1 && (x + y) % 2 === 0) c = C.pineLight;
      // Where a tier overhangs the one below: brown branch ends among dark needles.
      if (!inTree(x, y + 1) && Math.abs(x) >= 2) c = (x + y) % 2 === 0 ? C.bark : C.pineShade;
      // Snow on top of every tier, on whatever has open air above it, and a little deeper on the sunny side.
      if (!inTree(x, y - 1)) c = C.white;
      else if (!inTree(x, y - 2) && x < ww * 0.3 && speck(x, y, h) > 0.35) c = C.white;
      p.set(x, y, c);
    }
  }
  // the same snow clumps hanging off the tier edges as the black and white tree
  for (const [y, ww] of rows) {
    const below = rows.get(y + 1);
    if (below !== undefined && below > ww + 1) p.set(-ww - 1, y + 1, C.white);
  }
  return p.build(C.pineShade);
}

function colorBush(): ColorSprite {
  const p = new Paint();
  for (let y = -10; y <= 0; y++) {
    for (let x = -9; x <= 9; x++) {
      if (!inBush(x, y)) continue;
      let c: number = C.bush;
      if (isLeafHole(x, y) || (x > 3 && (x + y) % 3 === 0)) c = C.bushDark;
      // a dusting of snow on the tops of the puffs
      if (!inBush(x, y - 1) && speck(x, y, 3) > 0.4) c = C.white;
      p.set(x, y, c);
    }
  }
  return p.build(C.bushDark);
}

function colorDead(h: number): ColorSprite {
  const pts = makeDead(h);
  const p = new Paint();
  const has = new Set(pts.map(([x, y]) => (x + 512) * 1024 + (y + 512)));
  const filled = (x: number, y: number): boolean => has.has((x + 512) * 1024 + (y + 512));
  for (const [x, y] of pts) p.set(x, y, x > 0 && y > -h + 2 ? C.barkDark : C.bark);
  // snow resting on the branches: a white pixel on top wherever a branch has open air above it
  for (const [x, y] of pts) {
    if (x !== 0 && !filled(x, y - 1) && speck(x, y, h) > 0.3) p.set(x, y - 1, C.white);
  }
  p.set(0, -h - 1, C.white);
  return p.build(C.barkDark);
}

/** Odd variants are brown stone, even ones dark grey. */
function colorRock(size: number, variant: number, rng: Rng): ColorSprite {
  const brown = variant % 2 === 1;
  const base = brown ? C.rockBrown : C.rockGrey;
  const dark = brown ? C.rockBrownDark : C.rockGreyDark;
  const light = brown ? C.rockBrownLight : C.rockGreyLight;
  const { solid, carved } = rockShape(size, rng);
  const key = (x: number, y: number): number => (x + 512) * 1024 + (y + 512);
  const body = new Set(solid.map(([x, y]) => key(x, y)));
  const cut = new Set(carved.map(([x, y]) => key(x, y)));
  const top = Math.min(...solid.map(([, y]) => y));
  const p = new Paint();
  for (const [x, y] of solid) {
    let c: number = base;
    // grain: light flecks on the sunny upper left, dark ones low on the right, the facets dark
    const g = speck(x, y, size + variant * 13);
    if (cut.has(key(x, y))) c = dark;
    else if (x < 0 && g > 0.78) c = light;
    else if (x > 0 && g < 0.2) c = dark;
    // snow on top: the upper edge, and a cap on the top rows of a bigger rock
    const open = !body.has(key(x, y - 1));
    if (open && x < size * 0.3) c = C.white;
    else if (size >= 9 && y <= top + 1 && x < size * 0.15 && g > 0.25) c = C.white;
    p.set(x, y, c);
  }
  return p.build(dark);
}

function colorPebble(size: number): ColorSprite {
  const p = new Paint();
  for (const [x, y] of makePebble(size)) p.set(x, y, y < 0 ? C.rockGreyLight : C.rockGrey);
  return p.build(C.rockGreyDark);
}

const colorCache = new Map<number, ColorSprite>();

/** Build (or fetch from cache) the colour version of an obstacle's sprite. Same points as `getSprite`, painted. */
export function getColorSprite(kind: ObstacleKind, size: number, variant: number): ColorSprite {
  const key = (KIND_INDEX[kind] * 1000 + size) * 8 + (kind === 'rock' ? variant & 7 : 0);
  let sprite = colorCache.get(key);
  if (!sprite) {
    switch (kind) {
      case 'tree':
        sprite = colorPine(size);
        break;
      case 'bush':
        sprite = colorBush();
        break;
      case 'dead':
        sprite = colorDead(size);
        break;
      case 'rock':
        sprite = isPebble(kind, size)
          ? colorPebble(size)
          : colorRock(size, variant, new Rng(size * 131 + variant * 17 + 5));
        break;
    }
    colorCache.set(key, sprite);
  }
  return sprite;
}
