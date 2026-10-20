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
}
