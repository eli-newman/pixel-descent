import { describe, expect, it } from 'vitest';
import { STREAK_UNLOCK } from '../src/core/config';
import { dailySeed } from '../src/core/rng';
import { applyRun, createProgress, RIDERS, type RunSummary } from '../src/state/progress';
import { dayString } from '../src/state/runReport';
import { Store } from '../src/state/storage';
import { dayNumber, liveStreak, rideStreak, seedDay } from '../src/state/streak';
import { makeGame, memoryStorage, stepUntil } from './helpers/fakes';

function run(seed: string): RunSummary {
  return {
    seed,
    daily: seed.startsWith('d'),
    dist: 100,
    score: 100,
    stars: 0,
    laneStars: 0,
    nearMisses: 0,
    tricks: 0,
    landings: 0,
    grabs: 0,
    lines: 0,
    maxCombo: 0,
    sendItTime: 0,
    topSpeed: 100,
    time: 10,
    cause: 'obstacle',
  };
}

/** The daily course of a local day, and that day as saved. */
function on(y: number, m: number, d: number): { seed: string; day: string } {
  const date = new Date(y, m - 1, d, 12);
  return { seed: dailySeed(date), day: dayString(date) };
}

/** Ride the daily course of each day in turn and return the stats. */
function ride(days: Array<[number, number, number]>): ReturnType<typeof createProgress>['stats'] {
  const p = createProgress();
  for (const [y, m, d] of days) {
    const { seed, day } = on(y, m, d);
    rideStreak(p.stats, seed, day);
  }
  return p.stats;
}

describe('calendar days', () => {
  it('counts whole days across months, years, leap days and daylight saving', () => {
    const gap = (a: string, b: string): number => (dayNumber(b) ?? NaN) - (dayNumber(a) ?? NaN);
    expect(gap('2026-10-31', '2026-11-01')).toBe(1);
    expect(gap('2026-12-31', '2027-01-01')).toBe(1);
    expect(gap('2028-02-28', '2028-03-01')).toBe(2);
    expect(gap('2027-02-28', '2027-03-01')).toBe(1);
    // US and EU daylight saving changes: still one day apart.
    expect(gap('2026-03-08', '2026-03-09')).toBe(1);
    expect(gap('2026-10-25', '2026-10-26')).toBe(1);
    expect(gap('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('rejects anything that is not a real day', () => {
    for (const bad of ['', '2026-02-30', '2026-13-01', '26-10-20', 'd20261020', '2026-10-20T00:00'])
      expect(dayNumber(bad)).toBeNull();
    expect(seedDay('d20261020')).toBe('2026-10-20');
    expect(seedDay('rig')).toBeNull();
    expect(seedDay('d20261340')).toBeNull();
  });

  it('takes local days from the clock on both sides of a daylight saving change', () => {
    // The night the clocks go back has 25 hours: a run late that night is still on the same local day.
    expect(dayString(new Date(2026, 9, 25, 0, 30))).toBe('2026-10-25');
    expect(dayString(new Date(2026, 9, 25, 23, 30))).toBe('2026-10-25');
    expect(
      ride([
        [2026, 10, 25],
        [2026, 10, 26],
      ]).streak,
    ).toBe(2);
    expect(
      ride([
        [2026, 3, 8],
        [2026, 3, 9],
      ]).streak,
    ).toBe(2);
  });
});

describe('daily streak', () => {
  it('grows by one for each new day on the daily course, across a month and a year', () => {
    const s = ride([
      [2026, 12, 30],
      [2026, 12, 31],
      [2027, 1, 1],
    ]);
    expect(s.streak).toBe(3);
    expect(s.lastDay).toBe('2027-01-01');
    expect(
      ride([
        [2026, 10, 31],
        [2026, 11, 1],
      ]).streak,
    ).toBe(2);
  });

  it('counts a day once, however many daily runs it has', () => {
    const p = createProgress();
    const { seed, day } = on(2026, 10, 20);
    expect(rideStreak(p.stats, seed, day)).toBe(1);
    expect(rideStreak(p.stats, seed, day)).toBeNull();
    expect(p.stats.streak).toBe(1);
  });

  it('forgives one missed day', () => {
    expect(
      ride([
        [2026, 10, 20],
        [2026, 10, 22],
      ]).streak,
    ).toBe(2);
    expect(
      ride([
        [2026, 10, 20],
        [2026, 10, 21],
        [2026, 10, 23],
        [2026, 10, 24],
      ]).streak,
    ).toBe(4);
  });

  it('starts again at 1 after two missed days, keeping the best streak', () => {
    const s = ride([
      [2026, 10, 20],
      [2026, 10, 21],
      [2026, 10, 22],
      [2026, 10, 25],
    ]);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(3);
    expect(s.lastDay).toBe('2026-10-25');
  });

  it('only counts the daily course, and only today or a run that began before midnight', () => {
    const p = createProgress();
    const today = on(2026, 10, 20).day;
    expect(rideStreak(p.stats, 'rig', today)).toBeNull();
    expect(rideStreak(p.stats, 'd20261017', today)).toBeNull();
    expect(rideStreak(p.stats, 'd20261021', today)).toBeNull();
    // Yesterday's course finished after midnight counts for yesterday, and today's still counts after it.
    expect(rideStreak(p.stats, 'd20261019', today)).toBe(1);
    expect(p.stats.lastDay).toBe('2026-10-19');
    expect(rideStreak(p.stats, 'd20261020', today)).toBe(2);
  });

  it('reads as 0 once it can no longer be kept, without touching the save', () => {
    const s = ride([
      [2026, 10, 20],
      [2026, 10, 21],
    ]);
    expect(liveStreak(s, '2026-10-21')).toBe(2);
    expect(liveStreak(s, '2026-10-22')).toBe(2);
    expect(liveStreak(s, '2026-10-23')).toBe(2);
    expect(liveStreak(s, '2026-10-24')).toBe(0);
    expect(s.streak).toBe(2);
    expect(liveStreak(createProgress().stats, '2026-10-24')).toBe(0);
  });

  it(`unlocks the antlers on a ${STREAK_UNLOCK} day streak, and keeps them after it ends`, () => {
    const p = createProgress();
    const antlers = RIDERS.find((r) => r.id === 'antlers');
    expect(antlers?.need).toBe(`${STREAK_UNLOCK} DAY STREAK`);
    const unlockedOn: number[] = [];
    for (let d = 1; d <= STREAK_UNLOCK + 3; d++) {
      const { seed, day } = on(2026, 11, d);
      const out = applyRun(p, run(seed), day);
      expect(out.streak).toBe(d);
      if (out.newGear.some((g) => g.id === 'antlers')) unlockedOn.push(d);
    }
    expect(unlockedOn).toEqual([STREAK_UNLOCK]);
    const late = on(2026, 12, 1);
    expect(applyRun(p, run(late.seed), late.day).streak).toBe(1);
    expect(antlers?.unlocked(p)).toBe(true);
    expect(p.stats.bestStreak).toBe(STREAK_UNLOCK + 3);
  });
});

describe('daily streak in the game', () => {
  /** A device whose clock reads noon on a day, sharing one save. */
  function playDaily(storage: ReturnType<typeof memoryStorage>, y: number, m: number, d: number) {
    const rig = makeGame('rig', { now: () => new Date(y, m - 1, d, 12) }, storage);
    rig.game.press('daily');
    stepUntil(rig.game, () => rig.game.phase === 'over');
    return rig;
  }

  it('counts a finished daily run from the injected clock, saves it, and says so at game over', () => {
    const storage = memoryStorage();
    expect(playDaily(storage, 2026, 10, 20).game.result?.streak).toBe(1);
    const second = playDaily(storage, 2026, 10, 21);
    expect(second.game.result?.streak).toBe(2);
    expect(second.game.streak).toBe(2);
    // The same day again: nothing new to say.
    expect(playDaily(storage, 2026, 10, 21).game.result?.streak).toBeNull();
    const stats = new Store(storage).progress().stats;
    expect([stats.lastDay, stats.streak, stats.bestStreak]).toEqual(['2026-10-21', 2, 2]);
  });

  it('does not count a run on another course', () => {
    const storage = memoryStorage();
    const { game, input } = makeGame('rig', {}, storage);
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    expect(game.result?.streak).toBeNull();
    expect(new Store(storage).progress().stats.streak).toBe(0);
  });

  it('shows the live streak on the view, and 0 after two missed days', () => {
    const storage = memoryStorage();
    playDaily(storage, 2026, 10, 20);
    playDaily(storage, 2026, 10, 21);
    expect(makeGame('rig', { now: () => new Date(2026, 9, 23, 9) }, storage).game.streak).toBe(2);
    expect(makeGame('rig', { now: () => new Date(2026, 9, 24, 9) }, storage).game.streak).toBe(0);
    expect(playDaily(storage, 2026, 10, 24).game.result?.streak).toBe(1);
    expect(new Store(storage).progress().stats.bestStreak).toBe(2);
  });

  it('loads older saves with no streak, and drops a broken day', () => {
    const storage = memoryStorage();
    storage.setItem(
      'pixel-descent:v2:progress',
      JSON.stringify({ stats: { runs: 5, dailies: 2 }, achievements: {}, gear: {} }),
    );
    const stats = new Store(storage).progress().stats;
    expect([stats.lastDay, stats.streak, stats.bestStreak, stats.runs]).toEqual(['', 0, 0, 5]);
    const broken = memoryStorage();
    broken.setItem(
      'pixel-descent:v2:progress',
      JSON.stringify({ stats: { lastDay: 'yesterday', streak: 'x', bestStreak: 4 } }),
    );
    const b = new Store(broken).progress().stats;
    expect([b.lastDay, b.streak, b.bestStreak]).toEqual(['', 0, 4]);
  });
});
