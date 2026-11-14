/**
 * The three daily goals: one short, one medium and one long, picked from `GOAL_POOLS` by the local date, so every
 * player has the same three on a given day with no server. They count every run of the day on any course, and carry
 * over between runs until the day ends. Pure rules, no storage and no clock.
 */

import { GOAL_POOLS } from '../core/config';
import type { SimEvent } from '../sim/sim';
import type { Challenge, Progress, RunSummary } from './progress';
import { dayNumber, isDay } from './streak';

export type GoalTier = keyof typeof GOAL_POOLS;
export const GOAL_TIERS: readonly GoalTier[] = ['short', 'medium', 'long'];

/** What a run counts towards a goal. The pools in `GOAL_POOLS` may use any of these. */
export type GoalStat =
  | 'dist'
  | 'score'
  | 'stars'
  | 'nearMisses'
  | 'tricks'
  | 'landings'
  | 'grabs'
  | 'lines'
  | 'maxCombo';

export interface GoalDef {
  stat: GoalStat;
  /** The best single run of the day counts, instead of every run added up. */
  best: boolean;
  target: number;
}

/** The numbers of a run (or the run so far) that goals count. */
export type RunTally = Pick<RunSummary, GoalStat>;

/** What a run counts that the sim's score does not keep: landed grabs and jump lines landed clean all the way. */
export interface EventCounts {
  grabs: number;
  lines: number;
}

/** Count a sim event towards a run's grabs and clean lines (mutates `c`). */
export function countEvent(c: EventCounts, e: Readonly<SimEvent>): void {
  if (e.type === 'land' && e.quality === 'clean' && e.grab > 0) c.grabs += 1;
  if (e.type === 'line' && e.bonus > 0) c.lines += 1;
}

/** The day's goals as saved: the day they belong to and how far each has come. */
export interface DayGoals {
  /** Local day (YYYY-MM-DD) the values belong to, '' before the first run. */
  day: string;
  /** Progress of the short, medium and long goal, in their own units. */
  values: readonly number[];
  /** Days on which all three goals were done. */
  days: number;
}

export function createDayGoals(): DayGoals {
  return { day: '', values: [0, 0, 0], days: 0 };
}

/**
 * How far each tier's pick moves on from one day to the next. Each is coprime with its pool's length, so the same goal
 * never comes two days running and every goal in a pool comes round.
 */
const STRIDE: Record<GoalTier, number> = { short: 2, medium: 5, long: 1 };

/** The day's three goals, short, medium and long. No two of them count the same thing. */
export function goalDefs(day: string): GoalDef[] {
  const n = dayNumber(day) ?? 0;
  const used = new Set<GoalStat>();
  return GOAL_TIERS.map((tier, i) => {
    const pool: readonly GoalDef[] = GOAL_POOLS[tier];
    const len = pool.length;
    const start = (((n * STRIDE[tier] + i) % len) + len) % len;
    let def = pool[start] ?? pool[0];
    for (let k = 0; k < len && def && used.has(def.stat); k++) def = pool[(start + k + 1) % len];
    if (!def) throw new Error(`empty goal pool ${tier}`);
    used.add(def.stat);
    return def;
  });
}

/** The goal in words, for the GOALS screen, the title and toasts. */
export function goalName(g: Readonly<GoalDef>): string {
  const n = g.target;
  switch (g.stat) {
    case 'dist':
      return g.best ? `REACH ${n}M IN A RUN` : `RIDE ${n}M TODAY`;
    case 'score':
      return g.best ? `SCORE ${n} IN A RUN` : `SCORE ${n} TODAY`;
    case 'stars':
      return `TAKE ${n} STARS`;
    case 'nearMisses':
      return `${n} CLOSE CALLS`;
    case 'tricks':
      return `LAND ${n} TRICKS`;
    case 'landings':
      return `${n} CLEAN LANDINGS`;
    case 'grabs':
      return `LAND ${n} GRABS`;
    case 'lines':
      return n === 1 ? 'LAND A CLEAN LINE' : `LAND ${n} CLEAN LINES`;
    case 'maxCombo':
      return `HIT A X${n} COMBO`;
  }
}

/** A goal's progress with a run added: the better of the two for a best-run goal, else the sum. */
export function withRun(g: Readonly<GoalDef>, value: number, run: Readonly<RunTally>): number {
  const v = run[g.stat];
  return g.best ? Math.max(value, v) : value + v;
}

/** The saved progress of the day's goals: nothing yet when the save holds another day's. */
export function dayValues(goals: Readonly<DayGoals>, day: string): number[] {
  return goals.day === day ? [0, 1, 2].map((i) => goals.values[i] ?? 0) : [0, 0, 0];
}

/** The day's goals in the `Challenge` shape the GOALS screen draws, reading their progress from the save. */
export function dailyGoals(day: string): Challenge[] {
  return goalDefs(day).map((def, i) => ({
    id: `day${i}`,
    name: goalName(def),
    target: def.target,
    value: (p: Readonly<Pick<Progress, 'goals'>>) => dayValues(p.goals, day)[i] ?? 0,
  }));
}

export interface GoalsOutcome {
  /** The goals this run finished. */
  done: Challenge[];
  /** This run finished the last of the day's three. */
  all: boolean;
}

/** Add a finished run on `day` to the day's goals (mutates them), starting afresh on a new day. */
export function addRunToGoals(goals: DayGoals, run: Readonly<RunTally>, day: string): GoalsOutcome {
  const defs = goalDefs(day);
  const before = dayValues(goals, day);
  const after = defs.map((g, i) => withRun(g, before[i] ?? 0, run));
  goals.day = day;
  goals.values = after;
  const was = defs.map((g, i) => (before[i] ?? 0) >= g.target);
  const now = defs.map((g, i) => (after[i] ?? 0) >= g.target);
  const challenges = dailyGoals(day);
  const done = challenges.filter((_, i) => now[i] && !was[i]);
  const all = done.length > 0 && now.every(Boolean);
  if (all) goals.days += 1;
  return { done, all };
}

/** Read the day's goals from a save, keeping only what makes sense. */
export function loadDayGoals(raw: unknown): DayGoals {
  const g = createDayGoals();
  if (!raw || typeof raw !== 'object') return g;
  const r = raw as Partial<Record<keyof DayGoals, unknown>>;
  if (isDay(r.day)) g.day = r.day;
  if (Array.isArray(r.values)) {
    g.values = [0, 1, 2].map((i) => {
      const v: unknown = (r.values as unknown[])[i];
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    });
  }
  if (typeof r.days === 'number' && Number.isFinite(r.days) && r.days > 0)
    g.days = Math.floor(r.days);
  return g;
}
