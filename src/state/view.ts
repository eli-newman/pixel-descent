import type { Sim } from '../sim/sim';
import type { Trail } from '../sim/trail';
import type { Toast } from './feedback';
import type { Phase, Screen } from './menu';
import type { Progress } from './progress';
import type { RunResult } from './runReport';
import type { ScoreEntry, Settings } from './storage';

/** Readonly all the way down. Functions stay callable, so give views data, not mutating methods. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type TrailView = Readonly<Pick<Trail, 'count' | 'x' | 'y' | 'nx' | 'ny'>>;

export interface ParticlesView {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly landedCount: number;
  readonly landedX: ArrayLike<number>;
  readonly landedY: ArrayLike<number>;
}

/** The parts of the sim that get drawn. */
export type SimView = DeepReadonly<
  Pick<
    Sim,
    | 'rider'
    | 'score'
    | 'obstacles'
    | 'pickups'
    | 'ramps'
    | 'patches'
    | 'crashed'
    | 'crashT'
    | 'crashFace'
    | 'killer'
    | 'opts'
    | 'distM'
    | 'scoreValue'
    | 'tuck'
    | 'mult'
    | 'comboLeft'
  >
> & { readonly trail: TrailView };

/** Everything render/ may see of the game. Nothing here can change game state. Seeds are internal, so the player's screens cannot show one. */
export interface GameView {
  readonly phase: Phase;
  readonly screen: Screen;
  readonly scoreTab: 'top' | 'daily';
  readonly sim: SimView;
  readonly result: DeepReadonly<RunResult> | null;
  readonly focus: number;
  readonly focusVisible: boolean;
  readonly particles: ParticlesView;
  readonly toasts: readonly Readonly<Toast>[];
  readonly camYi: number;
  readonly animT: number;
  readonly settings: Readonly<Settings>;
  readonly progress: DeepReadonly<Progress>;
  readonly overallBest: number;
  /** Best score on today's daily course. */
  readonly dailyBest: number;
  readonly topRuns: readonly Readonly<ScoreEntry>[];
  readonly dailyRuns: readonly Readonly<ScoreEntry>[];
  readonly touch: boolean;
  readonly achievementCount: number;
  readonly boardIdx: number;
  readonly riderIdx: number;
  readonly crashWord: string;
}
