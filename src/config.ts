/** Logical (low-res) canvas size. It is scaled up by an integer factor to fit the window. */
export const W = 180;
export const H = 320;

/** Fixed simulation step in seconds. */
export const STEP = 1 / 120;
/** Longest frame time the loop will try to catch up on. */
export const MAX_FRAME = 0.25;

/** The rider starts in the middle of the slope, just below the start gate. */
export const START_X = W / 2;
export const START_Y = 120;
/** The camera keeps the rider this many pixels below the top of the screen when moving slowly. */
export const RIDER_SCREEN_Y = 118;
/** ...and this many when tucked at full speed, so more of the slope ahead is visible. */
export const RIDER_SCREEN_Y_FAST = 86;
/** World pixels per displayed metre. */
export const PX_PER_M = 8;
/** The rider is kept this far from the left and right edges of the slope. */
export const EDGE = 7;

/** Hard cap on rider speed in px/s (the old cruising cap was about 235). */
export const MAX_SPEED = 340;

/** Display speed: px/s to km/h. Purely cosmetic. */
export const KMH_PER_PXS = 0.4;

/** localStorage key prefix. Everything the game stores lives under this. */
export const SAVE_PREFIX = 'pixel-descent:v2:';
/** The single "best score" key of version 1, migrated into the overall best on first load. */
export const LEGACY_BEST_KEY = 'pixel-descent:best';

/**
 * Checkpoint gates are archived, not deleted: all the code (spawning, scoring, drawing, audio, tests) is
 * still here. Flip this to true to bring them back. See the "archive/checkpoints" git tag.
 */
export const CHECKPOINTS_ENABLED = false;

/**
 * The plain stars scattered along the safe path are archived (switched off, code kept). Only the
 * ringed risk-lane stars spawn. Set to true to bring the plain ones back.
 */
export const PATH_STARS_ENABLED = false;

/**
 * The ghost rider (a faint replay of your best run on a seed) is archived: switched off, code kept.
 * Set to true to race your ghost again.
 */
export const GHOST_ENABLED = false;

/**
 * The avalanche (a wall of snow chasing the rider down the hill) is archived: switched off, code kept
 * (sim, drawing, audio, warning gauge, tests). Set to true to be chased again.
 */
export const AVALANCHE_ENABLED = false;
