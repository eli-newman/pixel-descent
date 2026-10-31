import type { ResultCardData } from '../render/share';
import type { Sim } from '../sim/sim';
import { applyRun, type Achievement, type GearDef, type RunSummary } from './progress';
import type { Store } from './storage';

/** What the game over screen shows about the run that just ended. */
export interface RunResult {
  summary: RunSummary;
  score: number;
  dist: number;
  rank: number | null;
  newBest: boolean;
  achievements: Achievement[];
  gear: GearDef[];
}

export function dayString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function summarizeRun(sim: Sim, seed: string, daily: boolean): RunSummary {
  const sc = sim.score;
  return {
    seed,
    daily,
    dist: sim.distM,
    score: sim.scoreValue,
    stars: sc.stars,
    laneStars: sc.laneStars,
    nearMisses: sc.nearMisses,
    tricks: sc.tricks,
    landings: sc.landings,
    maxCombo: sc.maxCombo,
    sendItTime: sim.sendItTime,
    topSpeed: sim.topSpeedSeen,
    time: sim.runTime,
    cause: sim.crashCause,
  };
}

/** Save the run to the scoreboard and lifetime progress, and report what it earned. */
export function recordRun(store: Store, summary: RunSummary, day: string): RunResult {
  const { seed, score, dist } = summary;
  const rec = store.recordRun(seed, { score, dist, date: day });
  const out = applyRun(store.progress(), summary, day);
  store.saveProgress();
  return {
    summary,
    score,
    dist,
    rank: rec.rank,
    newBest: rec.newBest,
    achievements: out.newAchievements,
    gear: out.newGear,
  };
}

export function toCard(res: RunResult): ResultCardData {
  return {
    seed: res.summary.seed,
    daily: res.summary.daily,
    score: res.score,
    dist: res.dist,
    stars: res.summary.stars,
    nearMisses: res.summary.nearMisses,
    tricks: res.summary.tricks,
    cause: res.summary.cause,
    newBest: res.newBest,
  };
}
