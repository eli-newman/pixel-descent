import type { Game } from './game';

export type ButtonId =
  | 'play'
  | 'daily'
  | 'newseed'
  | 'scores'
  | 'gear'
  | 'goals'
  | 'sound'
  | 'back'
  | 'tabSeed'
  | 'tabDaily'
  | 'boardPrev'
  | 'boardNext'
  | 'riderPrev'
  | 'riderNext'
  | 'resume'
  | 'restart'
  | 'quit'
  | 'music'
  | 'hud'
  | 'autopause'
  | 'manual'
  | 'again'
  | 'retry'
  | 'share'
  | 'menu';

export interface UiButton {
  id: ButtonId;
  x: number;
  y: number;
  w: number;
  h: number;
  accent?: boolean;
}

/** Smallest button height in logical pixels. On a phone one logical pixel is about 2 CSS pixels, so this is a 44 px target. */
export const MIN_TOUCH = 22;

function b(id: ButtonId, x: number, y: number, w: number, h: number, accent = false): UiButton {
  return { id, x, y, w, h, accent };
}

const TITLE: UiButton[] = [
  b('play', 14, 172, 152, 26, true),
  b('daily', 14, 202, 74, MIN_TOUCH),
  b('newseed', 92, 202, 74, MIN_TOUCH),
  b('scores', 14, 228, 74, MIN_TOUCH),
  b('gear', 92, 228, 74, MIN_TOUCH),
  b('goals', 14, 254, 74, MIN_TOUCH),
  b('sound', 92, 254, 74, MIN_TOUCH),
];

const SCORES: UiButton[] = [
  b('tabSeed', 14, 34, 74, MIN_TOUCH),
  b('tabDaily', 92, 34, 74, MIN_TOUCH),
  b('back', 14, 286, 152, 26, true),
];

const GEAR: UiButton[] = [
  b('boardPrev', 14, 164, 28, 24),
  b('boardNext', 138, 164, 28, 24),
  b('riderPrev', 14, 214, 28, 24),
  b('riderNext', 138, 214, 28, 24),
  b('back', 14, 286, 152, 26, true),
];

const GOALS: UiButton[] = [b('back', 14, 286, 152, 26, true)];

const PAUSE: UiButton[] = [
  b('resume', 14, 70, 152, 26, true),
  b('restart', 14, 100, 74, MIN_TOUCH),
  b('quit', 92, 100, 74, MIN_TOUCH),
  b('sound', 14, 126, 74, MIN_TOUCH),
  b('music', 92, 126, 74, MIN_TOUCH),
  b('hud', 14, 152, 74, MIN_TOUCH),
  b('autopause', 92, 152, 74, MIN_TOUCH),
  b('manual', 14, 178, 152, MIN_TOUCH),
];

/** Top of the game over panel. The camera keeps the crash site above this line. */
export const OVER_PANEL_TOP = 150;

const OVER: UiButton[] = [
  b('again', 14, 238, 74, 24, true),
  b('retry', 92, 238, 74, 24),
  b('share', 14, 266, 74, 24),
  b('menu', 92, 266, 74, 24),
];

/** The buttons on screen right now, in keyboard focus order (first is the default action). */
export function menuButtons(g: Game): readonly UiButton[] {
  switch (g.phase) {
    case 'title':
      switch (g.screen) {
        case 'main':
          return TITLE;
        case 'scores':
          return SCORES;
        case 'gear':
          return GEAR;
        case 'goals':
          return GOALS;
      }
      return TITLE;
    case 'paused':
      return PAUSE;
    case 'over':
      return OVER;
    default:
      return [];
  }
}
