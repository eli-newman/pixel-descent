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
/** The camera keeps the rider this many pixels below the top of the screen. */
export const RIDER_SCREEN_Y = 120;
/** World pixels per displayed metre. */
export const PX_PER_M = 8;
/** The rider is kept this far from the left and right edges of the slope. */
export const EDGE = 7;

export const SAVE_KEY = 'pixel-descent:best';
