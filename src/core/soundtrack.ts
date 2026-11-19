import {
  MUSIC_FADE_S,
  MUSIC_LOBBY_BEAT_S,
  MUSIC_LOBBY_IN_S,
  MUSIC_PAUSE_FADE_S,
  MUSIC_PAUSE_LEVEL,
  MUSIC_RESTART_S,
  MUSIC_RUN_OUT_S,
  MUSIC_START_S,
} from './config';

/**
 * What the soundtrack should be doing, as a pure function of the game's scene, so the rules can be tested with no
 * audio at all. `Music` (platform/music.ts) applies the result. The scenes: `lobby` (title, menus, game over), `run`
 * (riding), `pause` (the pause menu) and `down` (a crash, from the fall to game over).
 */
export type Scene = 'lobby' | 'run' | 'pause' | 'down';

/** One part of the soundtrack (the lobby track or the run tracks) and where it should go. */
export interface Part {
  /** 0 to 1. 0 means silent and stopped once the fade is over. */
  level: number;
  /** Seconds to get there, equal-power. */
  fade: number;
  /** Seconds to wait before starting to. */
  delay: number;
}

export interface Mix {
  lobby: Part;
  run: Part;
  /** A new run track starts (as against going on with the one playing). */
  fresh: boolean;
}

/**
 * The mix for going from `prev` (null before anything has played) to `next`. `newRun` is true when this is a different
 * run than the one `prev` was in (a restart or retry). `sinceRunEnd` is the seconds since the run music was sent out,
 * which the lobby's beat of silence counts from. Null when nothing changes (menu to menu, a run carrying on).
 */
export function plan(
  prev: Scene | null,
  next: Scene,
  newRun: boolean,
  sinceRunEnd: number,
): Mix | null {
  switch (next) {
    case 'lobby': {
      if (prev === 'lobby') return null;
      const afterRun = prev !== null;
      return {
        lobby: {
          level: 1,
          fade: afterRun ? MUSIC_LOBBY_IN_S : MUSIC_FADE_S,
          delay: afterRun ? Math.max(0, MUSIC_LOBBY_BEAT_S - sinceRunEnd) : 0,
        },
        run: { level: 0, fade: MUSIC_RUN_OUT_S, delay: 0 },
        fresh: false,
      };
    }
    case 'run': {
      if (prev === 'run' && !newRun) return null;
      if (prev === 'pause' && !newRun) {
        return {
          lobby: { level: 0, fade: 0, delay: 0 },
          run: { level: 1, fade: MUSIC_PAUSE_FADE_S, delay: 0 },
          fresh: false,
        };
      }
      // From the lobby the run takes over slowly; from a run or a crash it starts straight away.
      const fade = prev === 'lobby' || prev === null ? MUSIC_START_S : MUSIC_RESTART_S;
      return {
        lobby: { level: 0, fade: MUSIC_START_S, delay: 0 },
        run: { level: 1, fade, delay: 0 },
        fresh: true,
      };
    }
    case 'pause': {
      if (prev !== 'run') return null;
      return {
        lobby: { level: 0, fade: 0, delay: 0 },
        run: { level: MUSIC_PAUSE_LEVEL, fade: MUSIC_PAUSE_FADE_S, delay: 0 },
        fresh: false,
      };
    }
    case 'down': {
      if (prev === 'down') return null;
      return {
        lobby: { level: 0, fade: MUSIC_RUN_OUT_S, delay: 0 },
        run: { level: 0, fade: MUSIC_RUN_OUT_S, delay: 0 },
        fresh: false,
      };
    }
  }
}

/**
 * One level that moves to a target over a time, equal-power: a rising level follows a quarter sine and a falling one a
 * quarter cosine, so two parts fading opposite ways at once keep the same power all the way (a straight ramp dips by
 * 3 dB in the middle). The time is passed in, so tests can run it on a made-up clock. Moving it again part way
 * through a fade starts from where it is.
 */
export class Fade {
  private from: number;
  private target: number;
  private start = 0;
  private dur = 0;

  constructor(level: number) {
    this.from = level;
    this.target = level;
  }

  /** Where the level is going. */
  get goal(): number {
    return this.target;
  }

  /** Set off for `target`, taking `seconds` from `now` (0 jumps there). */
  to(target: number, seconds: number, now: number): void {
    this.from = this.at(now);
    this.target = target;
    this.start = now;
    this.dur = Math.max(0, seconds);
  }

  at(now: number): number {
    if (this.dur <= 0) return this.target;
    const t = Math.min(1, Math.max(0, (now - this.start) / this.dur));
    if (t >= 1) return this.target;
    return this.target >= this.from
      ? this.from + (this.target - this.from) * Math.sin((t * Math.PI) / 2)
      : this.target + (this.from - this.target) * Math.cos((t * Math.PI) / 2);
  }

  /** True once it has arrived. */
  done(now: number): boolean {
    return this.dur <= 0 || now - this.start >= this.dur;
  }
}
