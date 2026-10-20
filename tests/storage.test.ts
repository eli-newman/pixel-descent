import { describe, expect, it } from 'vitest';
import { LEGACY_BEST_KEY, SAVE_PREFIX } from '../src/config';
import { Store, DEFAULT_SETTINGS } from '../src/storage';
import { memoryStorage } from './helpers/fakes';

const e = (score: number): { score: number; dist: number; date: string } => ({
  score,
  dist: score / 2,
  date: '2026-10-20',
});

describe('store', () => {
  it('keeps a sorted top 10 per seed', () => {
    const s = new Store(memoryStorage());
    for (let i = 1; i <= 14; i++) s.recordRun('a', e(i * 10));
    const board = s.leaderboard('a');
    expect(board).toHaveLength(10);
    expect(board.map((x) => x.score)).toEqual([140, 130, 120, 110, 100, 90, 80, 70, 60, 50]);
    expect(s.recordRun('a', e(5)).rank).toBeNull();
    expect(s.recordRun('a', e(95)).rank).toBe(6);
  });

  it('tracks best per seed and overall separately', () => {
    const s = new Store(memoryStorage());
    const a = s.recordRun('a', e(500));
    expect(a.newSeedBest && a.newOverallBest).toBe(true);
    const b = s.recordRun('b', e(300));
    expect(b.newSeedBest).toBe(true);
    expect(b.newOverallBest).toBe(false);
    expect(s.seedBest('b')).toBe(300);
    expect(s.overallBest()).toBe(500);
    expect(s.recordRun('b', e(200)).newSeedBest).toBe(false);
  });

  it('ignores zero scores', () => {
    const s = new Store(memoryStorage());
    expect(s.recordRun('a', e(0)).rank).toBeNull();
    expect(s.leaderboard('a')).toHaveLength(0);
  });

  it('persists across instances', () => {
    const st = memoryStorage();
    new Store(st).recordRun('a', e(42));
    expect(new Store(st).seedBest('a')).toBe(42);
  });

  it('migrates the old single best score', () => {
    const st = memoryStorage();
    st.setItem(LEGACY_BEST_KEY, '777');
    const s = new Store(st);
    expect(s.overallBest()).toBe(777);
    expect(s.seedBest('x')).toBe(0);
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
    expect(s.leaderboard('a')).toHaveLength(1);
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

  it('caps stored ghosts', () => {
    const st = memoryStorage();
    const s = new Store(st);
    for (let i = 0; i < 20; i++) {
      s.saveGhost(`g${i}`, {
        seed: `g${i}`,
        touch: false,
        steps: 1,
        score: 1,
        dist: 1,
        changes: [0, 8],
      });
    }
    const keys = [...st.data.keys()].filter((k) => k.includes('ghost:'));
    expect(keys.length).toBeLessThanOrEqual(12);
    expect(s.ghost('g19')).not.toBeNull();
    expect(s.ghost('g0')).toBeNull();
  });
});
