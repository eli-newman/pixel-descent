import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  BOARDS,
  CHALLENGES,
  RIDERS,
  applyRun,
  challengeDone,
  createProgress,
  cycleGear,
  sanitiseGear,
  type RunSummary,
} from '../src/state/progress';

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    seed: 'x',
    daily: false,
    dist: 100,
    score: 100,
    stars: 1,
    laneStars: 0,
    nearMisses: 0,
    tricks: 0,
    landings: 0,
    maxCombo: 0,
    sendItTime: 0,
    topSpeed: 100,
    time: 10,
    cause: 'obstacle',
    ...over,
  };
}

describe('progress', () => {
  it('awards achievements once', () => {
    const p = createProgress();
    const first = applyRun(p, run({ dist: 1200 }), '2026-10-20');
    expect(first.newAchievements.map((a) => a.id)).toEqual(['d250', 'd1000']);
    const second = applyRun(p, run({ dist: 1200 }), '2026-10-21');
    expect(second.newAchievements).toHaveLength(0);
    expect(p.achievements['d1000']).toBe('2026-10-20');
  });

  it('has unique ids and a small list', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(12);
  });

  it('accumulates stats and completes challenges', () => {
    const p = createProgress();
    applyRun(p, run({ nearMisses: 30 }), 'd');
    applyRun(p, run({ nearMisses: 25, dist: 1500, laneStars: 0 }), 'd');
    const near = CHALLENGES.find((c) => c.id === 'near50');
    const nostar = CHALLENGES.find((c) => c.id === 'nostar');
    expect(near && challengeDone(near, p)).toBe(true);
    expect(nostar && challengeDone(nostar, p)).toBe(true);
  });

  it('unlocks gear from distance and challenges, and reports it', () => {
    const p = createProgress();
    expect(BOARDS.filter((b) => b.unlocked(p))).toHaveLength(1);
    const out = applyRun(p, run({ dist: 600, nearMisses: 50 }), 'd');
    expect(out.newGear.map((g) => g.id).sort()).toEqual(['ears', 'stripe']);
    expect(RIDERS.find((r) => r.id === 'ears')?.unlocked(p)).toBe(true);
  });

  it('only cycles through unlocked gear and resets locked picks', () => {
    const p = createProgress();
    expect(cycleGear(BOARDS, 'classic', p, 1)).toBe('classic');
    applyRun(p, run({ dist: 600 }), 'd');
    expect(cycleGear(BOARDS, 'classic', p, 1)).toBe('stripe');
    p.gear.rider = 'ears';
    sanitiseGear(p);
    expect(p.gear.rider).toBe('classic');
  });
});
