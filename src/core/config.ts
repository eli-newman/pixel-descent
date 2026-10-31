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

/** Scale of the rider relative to the original 240x480 art. Larger than the first version so it reads at 180x320. */
export const RIDER_SCALE = 0.85;
/** Board length in px: it runs from the rider's feet along the heading to the nose. Gameplay (the spin pivot) and drawing share it. */
export const BOARD_LEN = Math.round(23 * RIDER_SCALE);
