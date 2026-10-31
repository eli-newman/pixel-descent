import { LEGACY_BEST_KEY, SAVE_PREFIX } from '../core/config';
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

interface ScoreBook {
  best: number;
  seeds: Record<string, ScoreEntry[]>;
  /** Seeds in the order they were last played, oldest first, to cap storage. */
  order: string[];
}

const TOP = 10;
const MAX_SEEDS = 80;
/** Replays of the removed ghost rider, one key per seed. */
const STALE_PREFIX = SAVE_PREFIX + 'ghost:';

export interface RecordResult {
  /** 1-based place on this seed's board, or null if the run did not make the top 10. */
  rank: number | null;
  newSeedBest: boolean;
  newOverallBest: boolean;
  seedBest: number;
  overallBest: number;
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

/**
 * Everything the game keeps between visits: per-seed top 10 boards, the overall best, settings
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
    const raw = this.read<Partial<ScoreBook>>('scores');
    const book: ScoreBook = { best: 0, seeds: {}, order: [] };
    if (raw && typeof raw === 'object') {
      if (typeof raw.best === 'number' && raw.best > 0) book.best = Math.floor(raw.best);
      if (raw.seeds && typeof raw.seeds === 'object') {
        for (const [seed, list] of Object.entries(raw.seeds)) {
          if (Array.isArray(list)) book.seeds[seed] = list.filter(isEntry).slice(0, TOP);
        }
      }
      if (Array.isArray(raw.order)) book.order = raw.order.filter((s) => typeof s === 'string');
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

  /** Best score over all seeds. */
  overallBest(): number {
    return this.load().best;
  }

  /** Top 10 for a seed, best first. */
  leaderboard(seed: string): readonly ScoreEntry[] {
    return this.load().seeds[seed] ?? [];
  }

  seedBest(seed: string): number {
    return this.leaderboard(seed)[0]?.score ?? 0;
  }

  /** Add a finished run. Seeds with no score are not stored. */
  recordRun(seed: string, entry: ScoreEntry): RecordResult {
    const book = this.load();
    const prevSeedBest = this.seedBest(seed);
    const prevOverall = book.best;
    const list = (book.seeds[seed] ?? []).slice();
    let rank: number | null = null;
    if (entry.score > 0) {
      let at = list.findIndex((e) => e.score < entry.score);
      if (at < 0) at = list.length;
      if (at < TOP) {
        list.splice(at, 0, entry);
        list.length = Math.min(list.length, TOP);
        rank = at + 1;
      }
      book.seeds[seed] = list;
      book.order = book.order.filter((s) => s !== seed);
      book.order.push(seed);
      while (book.order.length > MAX_SEEDS) {
        const old = book.order.shift();
        if (old !== undefined) delete book.seeds[old];
      }
      book.best = Math.max(book.best, entry.score);
      this.saveBook();
    }
    return {
      rank,
      newSeedBest: entry.score > 0 && entry.score > prevSeedBest,
      newOverallBest: entry.score > 0 && entry.score > prevOverall,
      seedBest: this.seedBest(seed),
      overallBest: book.best,
    };
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
