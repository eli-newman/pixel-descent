export type ObstacleKind = 'tree' | 'bush' | 'dead' | 'rock';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Sprite size parameter (height for trees, width for rocks). */
  size: number;
  /** Selects between sprite variations for the same kind and size. */
  variant: number;
  /** Centre x and base y in world space (y grows downhill). */
  x: number;
  y: number;
  /** Rough half width of the drawn sprite, used for spacing. */
  half: number;
  /** Already judged for a near miss. */
  judged: boolean;
  /** A bush that already slowed the rider. */
  touched: boolean;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
  taken: boolean;
  /** Points awarded. Risk lane stars are worth three times a normal star. */
  value: number;
  /** Part of a risk lane star trail. */
  lane: boolean;
}

/** A kicker. Riding over its lip launches the rider; the ground below it is kept clear to land on. */
export interface Ramp {
  id: number;
  x: number;
  /** World y of the lip. */
  y: number;
  /** Half the width of the kicker. */
  half: number;
  /** Solid obstacles are kept out of the landing zone between y and landEnd. */
  landEnd: number;
  used: boolean;
}

export type PatchKind = 'ice' | 'drift';

/** An ellipse of ice (loose steering) or snowdrift (heavy, slow snow). Not an obstacle: it never kills. */
export interface Patch {
  id: number;
  kind: PatchKind;
  x: number;
  y: number;
  /** Radii of the ellipse. */
  rx: number;
  ry: number;
  variant: number;
}

/** A checkpoint made of two flags. Pass between them for a bonus. */
export interface Gate {
  id: number;
  x: number;
  y: number;
  /** Half the distance between the flags. */
  half: number;
  passed: boolean;
  success: boolean;
}

export interface SpawnBatch {
  obstacles: Obstacle[];
  pickups: Pickup[];
  gates: Gate[];
  ramps: Ramp[];
  patches: Patch[];
}
