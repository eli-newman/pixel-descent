import { LEGACY_BEST_KEY, SAVE_PREFIX } from '../core/config';
import { isDailySeed } from '../core/rng';
import { createProgress, sanitiseGear, type Progress } from './progress';

/** The slice of the Storage API the game needs, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Only used to clear out old keys, so a backend without these just keeps them. */
  readonly length?: number;
  key?(index: number): string | null;
  removeItem?(key: string): void;
}

export interface ScoreEntry {
  score: number;
  dist: number;
  /** Local day the run was played, as YYYY-MM-DD. */
  date: string;
}

export interface Settings {
  muted: boolean;
  /** Very quiet procedural background music. Off by default. */
  music: boolean;
  /** Bigger score and distance text. */
  bigHud: boolean;
  /** Pause when the window loses focus. */
  autoPause: boolean;
  haptics: boolean;
  /** Manual spin: the arrows turn the rider freely in the air. Off by default (assisted spins). */
  manualSpin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  music: false,
  bigHud: false,
  autoPause: true,
  haptics: true,
  manualSpin: false,
};

/** The board of one daily course. Only the newest day is kept, as older ones are never shown. */
interface DailyBoard {
  seed: string;
  runs: ScoreEntry[];
}

interface ScoreBook {
  best: number;
  /** The best runs ever, on any course, best first. */
  top: ScoreEntry[];
  daily: DailyBoard | null;
}

/** A score book as saved. Older saves kept a board per seed instead of `top` and `daily`. */
interface SavedBook extends Partial<ScoreBook> {
  seeds?: Record<string, unknown>;
}

const TOP = 10;
/** Replays of the removed ghost rider, one key per course. */
const STALE_PREFIX = SAVE_PREFIX + 'ghost:';

export interface RecordResult {
  /** 1-based place among the best runs ever, or null if the run did not make the top 10. */
  rank: number | null;
  newBest: boolean;
  best: number;
}

function memoryBackend(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

function browserBackend(): StorageLike {
  try {
    const ls = window.localStorage;
    // Touch it once: some browsers only throw on first use.
    ls.getItem(SAVE_PREFIX + 'probe');
    return ls;
  } catch {
    return memoryBackend();
  }
}

function isEntry(v: unknown): v is ScoreEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<ScoreEntry>;
  return typeof e.score === 'number' && typeof e.dist === 'number' && typeof e.date === 'string';
}

function entries(list: unknown): ScoreEntry[] {
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

function bestFirst(list: ScoreEntry[]): ScoreEntry[] {
  return list.sort((x, y) => y.score - x.score).slice(0, TOP);
}

/** Put a run on a board, best first. Returns its 1-based place, or null if it did not make the top 10. */
function place(board: ScoreEntry[], entry: ScoreEntry): number | null {
  let at = board.findIndex((e) => e.score < entry.score);
  if (at < 0) at = board.length;
  if (at >= TOP) return null;
  board.splice(at, 0, entry);
  board.length = Math.min(board.length, TOP);
  return at + 1;
}

/** The all-time board of a save: as saved, or merged from the per-seed boards of an older save. */
function loadTop(raw: SavedBook): ScoreEntry[] {
  if (raw.top !== undefined) return bestFirst(entries(raw.top));
  const seeds = raw.seeds && typeof raw.seeds === 'object' ? Object.values(raw.seeds) : [];
  return bestFirst(seeds.flatMap(entries));
}

/** The daily board of a save: as saved, or the newest day's board of an older save. */
function loadDaily(raw: SavedBook): DailyBoard | null {
  const saved = raw.daily;
  if (saved && typeof saved === 'object' && typeof saved.seed === 'string') {
    return { seed: saved.seed, runs: bestFirst(entries(saved.runs)) };
  }
  if (!raw.seeds || typeof raw.seeds !== 'object') return null;
  // Daily seeds are dYYYYMMDD, so the newest day sorts last.
  const seed = Object.keys(raw.seeds).filter(isDailySeed).sort().pop();
  return seed === undefined ? null : { seed, runs: bestFirst(entries(raw.seeds[seed])) };
}

/**
 * Everything the game keeps between visits: the all-time top 10, today's top 10, the best score, settings
 * and progress. Every storage call is wrapped, because storage can be
 * blocked or full; the game then simply runs from memory for the session.
 */
export class Store {
  private readonly backend: StorageLike;
  private book: ScoreBook | null = null;
  private prog: Progress | null = null;
  private sett: Settings | null = null;

  constructor(backend?: StorageLike) {
    this.backend = backend ?? browserBackend();
    this.dropStaleKeys();
  }

  private dropStaleKeys(): void {
    const b = this.backend;
    if (b.length === undefined || !b.key || !b.removeItem) return;
    try {
      const stale: string[] = [];
      for (let i = 0; i < b.length; i++) {
        const key = b.key(i);
        if (key?.startsWith(STALE_PREFIX)) stale.push(key);
      }
      for (const key of stale) b.removeItem(key);
    } catch {
      // Blocked storage: the old keys are harmless, try again next visit.
    }
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.backend.getItem(SAVE_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.backend.setItem(SAVE_PREFIX + key, JSON.stringify(value));
    } catch {
      // Private mode or a full disk: the value lasts for this session only.
    }
  }

  private load(): ScoreBook {
    if (this.book) return this.book;
    const raw = this.read<SavedBook>('scores');
    const book: ScoreBook = { best: 0, top: [], daily: null };
    if (raw && typeof raw === 'object') {
      if (typeof raw.best === 'number' && raw.best > 0) book.best = Math.floor(raw.best);
      book.top = loadTop(raw);
      book.daily = loadDaily(raw);
    } else {
      // First run of this version: carry over the single best score of version 1.
      try {
        const n = Number(this.backend.getItem(LEGACY_BEST_KEY));
        if (Number.isFinite(n) && n > 0) book.best = Math.floor(n);
      } catch {
        // Ignore.
      }
    }
    this.book = book;
    return book;
  }

  private saveBook(): void {
    if (this.book) this.write('scores', this.book);
  }

  /** Best score ever. */
  overallBest(): number {
    return this.load().best;
  }

  /** The best runs ever, best first. */
  topRuns(): readonly ScoreEntry[] {
    return this.load().top;
  }

  /** The top 10 on a daily course, best first. */
  dailyRuns(seed: string): readonly ScoreEntry[] {
    const { daily } = this.load();
    return daily?.seed === seed ? daily.runs : [];
  }

  dailyBest(seed: string): number {
    return this.dailyRuns(seed)[0]?.score ?? 0;
  }

  /** Add a finished run. Runs with no score are not stored. */
  recordRun(seed: string, entry: ScoreEntry): RecordResult {
    const book = this.load();
    const prevBest = book.best;
    let rank: number | null = null;
    if (entry.score > 0) {
      rank = place(book.top, entry);
      book.best = Math.max(book.best, entry.score);
      if (isDailySeed(seed)) {
        // A link to an older daily course counts towards the records, not today's board.
        if (!book.daily || seed > book.daily.seed) book.daily = { seed, runs: [] };
        if (seed === book.daily.seed) place(book.daily.runs, entry);
      }
      this.saveBook();
    }
    return { rank, newBest: entry.score > prevBest && entry.score > 0, best: book.best };
  }

  settings(): Settings {
    if (this.sett) return this.sett;
    const raw = this.read<Partial<Settings>>('settings');
    const s: Settings = { ...DEFAULT_SETTINGS };
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
        const v = raw[k];
        if (typeof v === 'boolean') s[k] = v;
      }
    }
    this.sett = s;
    return s;
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const s = { ...this.settings(), ...patch };
    this.sett = s;
    this.write('settings', s);
    return s;
  }

  progress(): Progress {
    if (this.prog) return this.prog;
    const raw = this.read<Partial<Progress>>('progress');
    const p = createProgress();
    if (raw && typeof raw === 'object') {
      if (raw.stats && typeof raw.stats === 'object') {
        for (const k of Object.keys(p.stats) as Array<keyof Progress['stats']>) {
          const v = raw.stats[k];
          if (typeof v === 'number' && Number.isFinite(v)) p.stats[k] = v;
        }
      }
      if (raw.achievements && typeof raw.achievements === 'object') {
        for (const [k, v] of Object.entries(raw.achievements)) {
          if (typeof v === 'string') p.achievements[k] = v;
        }
      }
      if (raw.gear && typeof raw.gear === 'object') {
        if (typeof raw.gear.board === 'string') p.gear.board = raw.gear.board;
        if (typeof raw.gear.rider === 'string') p.gear.rider = raw.gear.rider;
      }
    }
    sanitiseGear(p);
    this.prog = p;
    return p;
  }

  saveProgress(): void {
    if (this.prog) this.write('progress', this.prog);
  }
}
