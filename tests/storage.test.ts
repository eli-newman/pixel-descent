import { describe, expect, it } from 'vitest';
import { LEGACY_BEST_KEY, SAVE_PREFIX } from '../src/core/config';
import { Store, DEFAULT_SETTINGS, type StorageLike } from '../src/state/storage';
import { memoryStorage } from './helpers/fakes';

/** Like localStorage: keys can be listed and removed. */
function listableStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
  };
}

const e = (score: number): { score: number; dist: number; date: string } => ({
  score,
  dist: score / 2,
  date: '2026-10-20',
});

describe('store', () => {
  it('keeps a sorted top 10 across every course', () => {
    const s = new Store(memoryStorage());
    for (let i = 1; i <= 14; i++) s.recordRun(`course${i}`, e(i * 10));
    expect(s.topRuns().map((x) => x.score)).toEqual([140, 130, 120, 110, 100, 90, 80, 70, 60, 50]);
    expect(s.recordRun('a', e(5)).rank).toBeNull();
    expect(s.recordRun('b', e(95)).rank).toBe(6);
  });

  it('only counts a new best when it beats every course', () => {
    const s = new Store(memoryStorage());
    expect(s.recordRun('a', e(500)).newBest).toBe(true);
    const b = s.recordRun('b', e(300));
    expect(b.newBest).toBe(false);
    expect(b.best).toBe(500);
    expect(s.overallBest()).toBe(500);
  });

  it('keeps a board for the newest daily course only', () => {
    const s = new Store(memoryStorage());
    s.recordRun('d20261019', e(50));
    s.recordRun('d20261020', e(30));
    s.recordRun('d20261020', e(40));
    s.recordRun('random', e(99));
    expect(s.dailyRuns('d20261020').map((x) => x.score)).toEqual([40, 30]);
    expect(s.dailyBest('d20261020')).toBe(40);
    expect(s.dailyRuns('d20261019')).toEqual([]);
    expect(s.dailyBest('d20261021')).toBe(0);
  });

  it('does not let a link to an older daily course replace the newest board', () => {
    const s = new Store(memoryStorage());
    s.recordRun('d20261020', e(30));
    s.recordRun('d20261019', e(70));
    expect(s.dailyBest('d20261020')).toBe(30);
    expect(s.overallBest()).toBe(70);
    expect(s.topRuns()[0]?.score).toBe(70);
  });

  it('ignores zero scores', () => {
    const s = new Store(memoryStorage());
    const r = s.recordRun('d20261020', e(0));
    expect(r.rank).toBeNull();
    expect(r.newBest).toBe(false);
    expect(s.topRuns()).toHaveLength(0);
    expect(s.dailyRuns('d20261020')).toHaveLength(0);
  });

  it('persists across instances', () => {
    const st = memoryStorage();
    const first = new Store(st);
    first.recordRun('a', e(42));
    first.recordRun('d20261020', e(21));
    const again = new Store(st);
    expect(again.topRuns().map((x) => x.score)).toEqual([42, 21]);
    expect(again.dailyBest('d20261020')).toBe(21);
  });

  it('merges the per-seed boards of an older save into one all-time board', () => {
    const st = memoryStorage();
    const seeds = {
      a: [e(300), e(100)],
      b: [e(200)],
      d20261019: [e(50)],
      d20261020: [e(40), e(20)],
      broken: 'nope',
    };
    st.setItem(SAVE_PREFIX + 'scores', JSON.stringify({ best: 900, seeds, order: ['a'] }));
    const s = new Store(st);
    expect(s.overallBest()).toBe(900);
    expect(s.topRuns().map((x) => x.score)).toEqual([300, 200, 100, 50, 40, 20]);
    expect(s.dailyRuns('d20261020').map((x) => x.score)).toEqual([40, 20]);
    s.recordRun('c', e(250));
    const raw = st.data.get(SAVE_PREFIX + 'scores');
    expect(raw).not.toContain('seeds');
    expect(raw).not.toContain('order');
    const again = new Store(st);
    expect(again.topRuns().map((x) => x.score)).toEqual([300, 250, 200, 100, 50, 40, 20]);
    expect(again.dailyBest('d20261020')).toBe(40);
  });

  it('migrates the old single best score', () => {
    const st = memoryStorage();
    st.setItem(LEGACY_BEST_KEY, '777');
    const s = new Store(st);
    expect(s.overallBest()).toBe(777);
    expect(s.topRuns()).toEqual([]);
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    const s = new Store(bad);
    expect(s.overallBest()).toBe(0);
    expect(s.recordRun('a', e(10)).rank).toBe(1);
    expect(s.topRuns()).toHaveLength(1);
    expect(s.saveSettings({ muted: true }).muted).toBe(true);
  });

  it('shrugs off corrupt data', () => {
    const st = memoryStorage();
    st.setItem(SAVE_PREFIX + 'scores', '{not json');
    st.setItem(SAVE_PREFIX + 'settings', '[1,2]');
    st.setItem(SAVE_PREFIX + 'progress', '"x"');
    const s = new Store(st);
    expect(s.overallBest()).toBe(0);
    expect(s.settings()).toEqual(DEFAULT_SETTINGS);
    expect(s.progress().stats.runs).toBe(0);
  });

  it('defaults to sound on, music off', () => {
    expect(DEFAULT_SETTINGS.muted).toBe(false);
    expect(DEFAULT_SETTINGS.music).toBe(false);
  });

  it('loads a save written before ghosts and gates were removed', () => {
    const st = memoryStorage();
    st.setItem(
      SAVE_PREFIX + 'scores',
      JSON.stringify({
        best: 500,
        seeds: { old: [{ score: 500, dist: 100, date: '2026-01-02' }] },
        order: ['old'],
        ghosts: ['old'],
      }),
    );
    st.setItem(
      SAVE_PREFIX + 'progress',
      JSON.stringify({
        stats: { runs: 7, tricks: 12, gates: 3 },
        achievements: { photo: '2026-01-02' },
        gear: { board: 'dots', rider: 'classic' },
      }),
    );
    st.setItem(SAVE_PREFIX + 'ghost:old', JSON.stringify({ seed: 'old', changes: [] }));
    const s = new Store(st);
    expect(s.overallBest()).toBe(500);
    expect(s.topRuns()[0]?.score).toBe(500);
    const p = s.progress();
    expect(p.stats.runs).toBe(7);
    expect(p.stats.tricks).toBe(12);
    expect(p.achievements['photo']).toBe('2026-01-02');
    expect(p.gear.board).toBe('dots');
    s.recordRun('new', { score: 10, dist: 1, date: '2026-01-03' });
    s.saveProgress();
    const again = new Store(st);
    expect(again.topRuns().map((x) => x.score)).toEqual([500, 10]);
    expect(again.progress().stats.runs).toBe(7);
  });

  it('clears old ghost replays and keeps everything else', () => {
    const st = listableStorage();
    st.setItem(SAVE_PREFIX + 'ghost:a', '{}');
    st.setItem(SAVE_PREFIX + 'ghost:b', '{}');
    const kept = {
      [SAVE_PREFIX + 'scores']: JSON.stringify({ best: 9, seeds: {}, order: [] }),
      [SAVE_PREFIX + 'settings']: JSON.stringify({ muted: true }),
      [SAVE_PREFIX + 'progress']: JSON.stringify({ stats: { runs: 3 } }),
      [LEGACY_BEST_KEY]: '5',
      'pixel-descent:v1:ghost:a': 'other version',
      'someone-else:ghost:a': 'not ours',
    };
    for (const [k, v] of Object.entries(kept)) st.setItem(k, v);
    const s = new Store(st);
    expect(Object.fromEntries(st.data)).toEqual(kept);
    expect(s.overallBest()).toBe(9);
    expect(s.settings().muted).toBe(true);
    expect(s.progress().stats.runs).toBe(3);
  });

  it('survives storage that throws while clearing old keys', () => {
    const lists = listableStorage();
    lists.setItem(SAVE_PREFIX + 'ghost:a', '{}');
    const badKey: StorageLike = {
      ...lists,
      length: 1,
      key: () => {
        throw new Error('blocked');
      },
    };
    const badRemove: StorageLike = {
      ...lists,
      length: 1,
      key: () => SAVE_PREFIX + 'ghost:a',
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    for (const bad of [badKey, badRemove]) {
      expect(new Store(bad).overallBest()).toBe(0);
    }
  });

  it('drops removed fields from a save the next time it is written', () => {
    const st = memoryStorage();
    st.setItem(
      SAVE_PREFIX + 'scores',
      JSON.stringify({ best: 5, seeds: {}, order: [], ghosts: ['old'] }),
    );
    st.setItem(SAVE_PREFIX + 'progress', JSON.stringify({ stats: { runs: 1, gates: 3 } }));
    const s = new Store(st);
    s.recordRun('a', e(10));
    s.progress();
    s.saveProgress();
    expect(st.data.get(SAVE_PREFIX + 'scores')).not.toContain('ghosts');
    expect(st.data.get(SAVE_PREFIX + 'progress')).not.toContain('gates');
  });
});
