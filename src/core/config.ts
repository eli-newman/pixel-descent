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
 * a player's first TUTORIAL_RUNS runs (so a returning player never sees it). Until every lesson has been shown a new
 * player rides TUTORIAL_SEED, a gentle course (the spawner builds this seed with fewer obstacles at the top, the first
 * star lane, then one kicker, then a cliff) picked so the lessons come one at a time in order: steer, crash, star,
 * jump, cliff, with no kicker or cliff before its lesson. A run rides free for LESSON_FIRST seconds before the first lesson, and LESSON_GAP seconds between one
 * lesson going and the next. A lesson shows when the run, slowing to a stop over LESSON_EASE_IN seconds while the words
 * fade in, will stop with its thing between LESSON_AHEAD_MIN and LESSON_AHEAD_MAX px below the rider: on screen,
 * with room to act on the lesson. A tap counts only after LESSON_GUARD seconds, so a thumb already on its way
 * down does not skip one unread, and the run picks up speed again over LESSON_EASE_OUT seconds.
 */
export const TUTORIAL_RUNS = 3;
export const TUTORIAL_SEED = 'tut19';
export const LESSON_AHEAD_MIN = 70;
export const LESSON_AHEAD_MAX = 150;
export const LESSON_FIRST = 1.5;
export const LESSON_GAP = 3;
export const LESSON_EASE_IN = 0.45;
export const LESSON_EASE_OUT = 0.35;
export const LESSON_GUARD = 1;

/**
 * Properties sent with each analytics event, most important first. Vercel Web Analytics allows 2 on Pro and 8 on
 * Pro with the Web Analytics Plus add-on (Hobby has no custom events at all). Raise it to 8 after buying Plus.
 */
export const ANALYTICS_MAX_PROPS = 2;

/**
 * The daily-ride streak (`state/streak.ts`): a finished run on the daily course keeps it going for that local day.
 * Up to STREAK_GRACE days may be missed in a row without losing it; missing more starts a new streak at 1 on the
 * next daily run. A best streak of STREAK_UNLOCK days unlocks a rider look.
 */
export const STREAK_GRACE = 1;
export const STREAK_UNLOCK = 7;

/**
 * The three daily goals (`state/goals.ts`): one short, one medium and one long goal a day, picked from these pools by
 * the local date. `stat` is what a run counts (`dist` metres, `score`, `stars`, `tricks`, `landings` clean landings,
 * `grabs` landed grabs, `lines` jump lines landed clean; `nearMisses` and `maxCombo` also work). `best` goals take the
 * best single run of the day, the rest add up every run of the day. A short goal is about one ordinary run, a medium
 * one a few runs or a good run, a long one a whole session. Sized from what the sim pays: a clean landing about every
 * 100 m, a clean line every 600 m or so from 150 m, risk lane stars about 80 per 1000 m on offer. Bots in
 * `tests/goals.test.ts` reach every goal in its tier's runs (short 1 run of 600 m, medium 3 of 900 m, long 6 of
 * 1600 m). Close calls and combos are left out: the open path keeps them rare (well under one a run off a risk lane),
 * so no fair number fits a day, and the 50 CLOSE CALLS challenge and COMBO KING already ask for them.
 */
export const GOAL_POOLS = {
  short: [
    { stat: 'dist', best: false, target: 500 },
    { stat: 'dist', best: true, target: 300 },
    { stat: 'stars', best: false, target: 10 },
    { stat: 'landings', best: false, target: 3 },
    { stat: 'tricks', best: false, target: 2 },
  ],
  medium: [
    { stat: 'dist', best: false, target: 2000 },
    { stat: 'stars', best: false, target: 30 },
    { stat: 'landings', best: false, target: 10 },
    { stat: 'tricks', best: false, target: 8 },
    { stat: 'grabs', best: false, target: 3 },
    { stat: 'score', best: true, target: 2000 },
  ],
  long: [
    { stat: 'dist', best: false, target: 5000 },
    { stat: 'dist', best: true, target: 1500 },
    { stat: 'stars', best: false, target: 60 },
    { stat: 'tricks', best: false, target: 20 },
    { stat: 'lines', best: false, target: 2 },
    { stat: 'score', best: true, target: 5000 },
  ],
} as const;

/**
 * PostHog, the second analytics recipient (`platform/posthog.ts`). Events go to INGEST_PATH on this site, a Vercel
 * function (`server/ingestHandler.ts`) that drops the player's IP address and forwards them to POSTHOG_UPSTREAM, the
 * EU cloud. The path is plain on purpose: ad blockers know `/analytics`, `/posthog` and `/batch`. The browser sends
 * once POSTHOG_FLUSH_EVENTS are waiting or when the page is hidden, and never retries. The function refuses a body
 * over INGEST_MAX_BYTES (a batch of 10 events is about 4 KB, and a beacon may carry at most 64 KB).
 */
export const INGEST_PATH = 'flurry';
export const POSTHOG_UPSTREAM = 'https://eu.i.posthog.com';
export const POSTHOG_FLUSH_EVENTS = 10;
export const INGEST_MAX_BYTES = 32 * 1024;

/**
 * Analytics sessions: one starts when the page loads, or when it comes back after SESSION_GAP_MS or more hidden (the
 * 30 minutes GA4 uses); a shorter break carries on the same session. A run counts as close to the best when its score
 * is at least BEST_CLOSE of the best before it.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const BEST_CLOSE = 0.9;

/**
 * The soundtrack (`platform/music.ts`): files in `public/music/`, AAC in .m4a so every browser and web view plays
 * them, all normalized to one loudness. Titles are the file names in title case. It has two parts: the lobby (title,
 * menus, game over), one fixed track that loops, and the run (while riding), the other tracks on a shuffle that never
 * repeats one straight away. MUSIC_LOBBY is the file of the lobby track: change that one word to swap it (it is
 * picked out of the run's shuffle by itself). It is the calmest of the six: lowest density of strong onsets and of
 * high-frequency energy, slowest tempo and steadiest loudness (measured with ffmpeg, see the README).
 *
 * Levels and timings, in seconds. MUSIC_LEVEL is the music's gain under the master (the effects are deliberately
 * quiet, so this is a share of them, not of the track). MUSIC_FADE_S: the fade in when music starts or comes back
 * (the first gesture, the MUSIC switch, a page shown again). MUSIC_START_S: lobby to run crossfade when a run starts.
 * MUSIC_RESTART_S: the crossfade to a fresh run track when a run is restarted. MUSIC_RUN_OUT_S: the run music's fade
 * out when the run ends (a crash, QUIT, MENU). MUSIC_LOBBY_BEAT_S: silence after the run music went out before the
 * lobby track comes back, so a crash lands in near silence. MUSIC_LOBBY_IN_S: the lobby's fade in.
 * MUSIC_PAUSE_LEVEL and MUSIC_PAUSE_FADE_S: how far the run music ducks on pause and how fast it moves.
 * MUSIC_CROSS_S: the equal-power overlap from one track to the next inside a run, and for the lobby track into
 * itself, as it loops (the files carry their own soft ends). MUSIC_PREFETCH_S: how many seconds before a track ends
 * the next one starts downloading (nothing is fetched before the first gesture). MUSIC_MAX_FAILS: failed tracks in a
 * row (a missing file, a decode error) after which a part gives up.
 */
export const MUSIC_TRACKS = [
  { file: 'yumon.m4a', title: 'Yumon' },
  { file: 'roronora-remix-2.m4a', title: 'Roronora Remix 2' },
  { file: 'drunk-diver.m4a', title: 'Drunk Diver' },
  { file: 'montage.m4a', title: 'Montage' },
  { file: 'vivands.m4a', title: 'Vivands' },
  { file: 'gust-of-coal.m4a', title: 'Gust of Coal' },
] as const;
export const MUSIC_LOBBY = 'vivands.m4a' satisfies (typeof MUSIC_TRACKS)[number]['file'];
export const MUSIC_DIR = 'music/';
export const MUSIC_LEVEL = 0.3;
export const MUSIC_FADE_S = 1.2;
export const MUSIC_START_S = 1.5;
export const MUSIC_RESTART_S = 0.8;
export const MUSIC_RUN_OUT_S = 0.6;
export const MUSIC_LOBBY_BEAT_S = 1;
export const MUSIC_LOBBY_IN_S = 1.5;
export const MUSIC_PAUSE_LEVEL = 0.25;
export const MUSIC_PAUSE_FADE_S = 0.4;
export const MUSIC_CROSS_S = 4;
export const MUSIC_PREFETCH_S = 20;
export const MUSIC_MAX_FAILS = 3;
