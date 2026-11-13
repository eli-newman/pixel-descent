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

/**
 * Jumps (kickers and cliffs): the first one's distance below the start, and the clear ground from the end
 * of one jump's landing zone (or the end of a whole jump line) to the next lip, before a random extra of
 * up to JUMP_JITTER. In px (8 per metre). A landing zone is 250-370 px, so a jump comes about every
 * 75 m early on and every 90 m at speed: every 3 to 4 s at cruising speed, so the middle of a run never
 * goes quiet. The 300 px floor keeps a rider well clear of one landing before the next run-up.
 */
export const FIRST_JUMP_Y = 360;
export const JUMP_GAP_MIN = 300;
export const JUMP_GAP_MAX = 380;
export const JUMP_JITTER = 40;
/**
 * Jump lines: two or three kickers in a row, aligned and the same width, each lip a short run-up after
 * the previous one's landing zone. The chance that a kicker starts a line grows from LINE_CHANCE_START
 * to LINE_CHANCE_END with distance (LINE_CHANCE_M sets how fast), and no line comes before LINE_START_M.
 * LINE_THREE_CHANCE is the share of lines with three kickers.
 */
export const LINE_START_M = 150;
export const LINE_CHANCE_START = 0.2;
export const LINE_CHANCE_END = 0.45;
export const LINE_CHANCE_M = 1500;
export const LINE_THREE_CHANCE = 0.4;
/** Clear snow between a line kicker's landing zone (sized for top speed) and the next lip, in px. */
export const LINE_RUNUP_MIN = 50;
export const LINE_RUNUP_MAX = 80;
/** Trick points of each clean landing in a line are multiplied by these, by its place in the line. */
export const LINE_MULTS = [1, 1.5, 2] as const;
/** Landing every kicker of a line clean pays this per kicker, times the speed multiplier. */
export const LINE_BONUS = 30;
/** Share of jumps that are cliffs instead of kickers. A cliff clears far more landing ground, so most jumps are kickers. */
export const CLIFF_CHANCE = 0.3;
/** Half width of a kicker in px. Wide enough to hit without lining up to the pixel, still inside the open path. */
export const KICKER_HALF = 17;

/** Hard cap on rider speed in px/s (the old cruising cap was about 235). */
export const MAX_SPEED = 340;

/** Display speed: px/s to km/h. Purely cosmetic. */
export const KMH_PER_PXS = 0.4;

/** localStorage key prefix. Everything the game stores lives under this. Keeps the game's old name on purpose: changing it would wipe every player's scores and gear. */
export const SAVE_PREFIX = 'pixel-descent:v2:';
/** The single "best score" key of version 1, migrated into the overall best on first load. */
export const LEGACY_BEST_KEY = 'pixel-descent:best';

/** Scale of the rider relative to the original 240x480 art. Larger than the first version so it reads at 180x320. */
export const RIDER_SCALE = 0.85;
/** Board length in px: it runs from the rider's feet along the heading to the nose. Gameplay (the spin pivot) and drawing share it. */
export const BOARD_LEN = Math.round(23 * RIDER_SCALE);

/**
 * The first-run tutorial (`state/tutorial.ts`): a lesson stops the run once, the first time its thing comes up, on
 * a player's first TUTORIAL_RUNS runs (so a returning player never sees it). It shows when the thing is between
 * LESSON_AHEAD_MIN and LESSON_AHEAD_MAX px below the rider: on screen, with room to act on the lesson. A tap counts
 * only after LESSON_GUARD seconds, so a thumb already on its way down does not skip one unread. The first
 * LESSON_FREE_RIDE px of a run ride free, so the steering lesson is never followed at once by another stop.
 */
export const TUTORIAL_RUNS = 3;
export const LESSON_AHEAD_MIN = 70;
export const LESSON_AHEAD_MAX = 150;
export const LESSON_GUARD = 0.4;
export const LESSON_FREE_RIDE = 60;

/**
 * Properties sent with each analytics event, most important first. Vercel Web Analytics allows 2 on Pro and 8 on
 * Pro with the Web Analytics Plus add-on (Hobby has no custom events at all). Raise it to 8 after buying Plus.
 */
export const ANALYTICS_MAX_PROPS = 2;
