import { describe, expect, it } from 'vitest';
import { GOAL_POOLS } from '../src/core/config';
import { Sim, type SimInput } from '../src/sim/sim';
import {
  addRunToGoals,
  countEvent,
  createDayGoals,
  dailyGoals,
  goalDefs,
  goalName,
  GOAL_TIERS,
  loadDayGoals,
  withRun,
  type EventCounts,
  type GoalDef,
  type GoalTier,
  type RunTally,
} from '../src/state/goals';
import { challengeDone, createProgress } from '../src/state/progress';
import { dayString, summarizeRun } from '../src/state/runReport';
import { Store } from '../src/state/storage';
import { botInput, kickerBotInput } from './helpers/bot';
import { makeGame, memoryStorage, stepUntil } from './helpers/fakes';

const ZERO: RunTally = {
  dist: 0,
  score: 0,
  stars: 0,
  nearMisses: 0,
  tricks: 0,
  landings: 0,
  grabs: 0,
  lines: 0,
  maxCombo: 0,
};

/** Every local day for a stretch of the calendar, as saved. */
function days(n: number, from = new Date(2026, 0, 1, 12)): string[] {
  return Array.from({ length: n }, (_, i) =>
    dayString(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, 12)),
  );
}

describe('daily goals', () => {
  it('are the same three for the same date, short, medium and long', () => {
    for (const day of days(40)) {
      const defs = goalDefs(day);
      expect(goalDefs(day)).toEqual(defs);
      expect(defs).toHaveLength(3);
      GOAL_TIERS.forEach((tier, i) => {
        const pool: readonly GoalDef[] = GOAL_POOLS[tier];
        expect(pool).toContainEqual(defs[i]);
      });
    }
  });

  it('change from day to day, never count the same thing twice in a day, and every goal comes round', () => {
    const year = days(365);
    const repeats: string[] = [];
    const doubled: string[] = [];
    const seen: Record<GoalTier, Set<string>> = {
      short: new Set(),
      medium: new Set(),
      long: new Set(),
    };
    year.forEach((day, k) => {
      const defs = goalDefs(day);
      const prev = k > 0 ? goalDefs(year[k - 1] ?? '') : null;
      if (prev && defs.every((d, i) => goalName(d) === goalName(prev[i] ?? d))) repeats.push(day);
      if (new Set(defs.map((d) => d.stat)).size !== 3) doubled.push(day);
      GOAL_TIERS.forEach((tier, i) => seen[tier].add(goalName(defs[i] ?? defs[0] ?? ZERO_DEF)));
    });
    expect(repeats).toEqual([]);
    expect(doubled).toEqual([]);
    for (const tier of GOAL_TIERS) expect(seen[tier].size).toBe(GOAL_POOLS[tier].length);
  });

  it('name every goal so it fits on a GOALS row', () => {
    for (const tier of GOAL_TIERS) {
      for (const def of GOAL_POOLS[tier]) {
        // 4 px a letter: the name and its count share 148 px with a gap.
        const count = `${def.target}/${def.target}`;
        expect((goalName(def).length + count.length + 2) * 4).toBeLessThanOrEqual(148);
      }
    }
  });

  it('add up runs, or take the best run, by goal', () => {
    const sum: GoalDef = { stat: 'stars', best: false, target: 10 };
    const best: GoalDef = { stat: 'dist', best: true, target: 500 };
    expect(withRun(sum, 4, { ...ZERO, stars: 3 })).toBe(7);
    expect(withRun(best, 300, { ...ZERO, dist: 200 })).toBe(300);
    expect(withRun(best, 300, { ...ZERO, dist: 450 })).toBe(450);
  });

  it('carry over between runs of a day, start afresh the next, and reward all three once', () => {
    const p = createProgress();
    const day = '2026-10-20';
    const defs = goalDefs(day);
    // A run that does nothing still claims the day.
    expect(addRunToGoals(p.goals, ZERO, day)).toEqual({ done: [], all: false });
    expect(p.goals.day).toBe(day);
    // One run that does all but the last step of each goal, then one that finishes them.
    const most = runOf(defs, (g) => (g.best ? g.target : g.target - 1));
    const first = addRunToGoals(p.goals, most, day);
    const bestOnes = defs.filter((g) => g.best).length;
    expect(first.done).toHaveLength(bestOnes);
    expect(first.all).toBe(bestOnes === 3);
    const rest = runOf(defs, (g) => (g.best ? 0 : 1));
    const second = addRunToGoals(p.goals, rest, day);
    expect(second.done.length + first.done.length).toBe(3);
    expect(second.all).toBe(true);
    expect(p.goals.days).toBe(1);
    expect(dailyGoals(day).every((c) => challengeDone(c, p))).toBe(true);
    // More runs that day change nothing more.
    expect(addRunToGoals(p.goals, most, day)).toEqual({ done: [], all: false });
    expect(p.goals.days).toBe(1);
    // A new day: fresh goals at nothing done, the count of finished days kept.
    const next = '2026-10-21';
    expect(dailyGoals(next).map((c) => c.value(p))).toEqual([0, 0, 0]);
    addRunToGoals(p.goals, ZERO, next);
    expect(p.goals.values).toEqual([0, 0, 0]);
    expect(p.goals.days).toBe(1);
  });

  it('count landed grabs and clean lines from events', () => {
    const c: EventCounts = { grabs: 0, lines: 0 };
    const land = {
      type: 'land',
      quality: 'clean',
      pts: 40,
      tricks: 0,
      spin: 0,
      switch: false,
      flips: 0,
      grab: 0.4,
      held: false,
    } as const;
    countEvent(c, land);
    countEvent(c, { ...land, quality: 'sloppy' });
    countEvent(c, { ...land, grab: 0 });
    countEvent(c, { type: 'line', landed: 2, len: 2, mult: 1.5, bonus: 60, broken: null });
    countEvent(c, { type: 'line', landed: 1, len: 2, mult: 1.5, bonus: 0, broken: null });
    expect(c).toEqual({ grabs: 1, lines: 1 });
  });

  it('load from older saves and junk safely', () => {
    expect(loadDayGoals(undefined)).toEqual(createDayGoals());
    expect(loadDayGoals({ day: 'today', values: ['x', -3, 7, 9], days: -2 })).toEqual({
      day: '',
      values: [0, 0, 7],
      days: 0,
    });
    const storage = memoryStorage();
    storage.setItem('pixel-descent:v2:progress', JSON.stringify({ stats: { runs: 3 } }));
    expect(new Store(storage).progress().goals).toEqual(createDayGoals());
  });
});

/** A run whose numbers for the day's goals come from `f`. */
function runOf(defs: readonly GoalDef[], f: (g: GoalDef) => number): RunTally {
  const t = { ...ZERO };
  for (const g of defs) t[g.stat] = f(g);
  return t;
}

const ZERO_DEF: GoalDef = { stat: 'dist', best: false, target: 1 };

describe('daily goals in the game', () => {
  const at =
    (d: number): (() => Date) =>
    () =>
      new Date(2026, 9, d, 12);

  it('save progress between runs of the day, on any course', () => {
    const storage = memoryStorage();
    const a = makeGame('rig', { now: at(20) }, storage);
    a.input.push('start');
    stepUntil(a.game, () => a.game.phase === 'over');
    const after1 = a.game.dailyGoals.map((c) => c.value(a.game.progress));
    expect(after1.some((v) => v > 0)).toBe(true);
    const b = makeGame('other', { now: at(20) }, storage);
    expect(b.game.dailyGoals.map((c) => c.value(b.game.progress))).toEqual(after1);
    b.input.push('start');
    stepUntil(b.game, () => b.game.phase === 'over');
    const after2 = b.game.dailyGoals.map((c) => c.value(b.game.progress));
    after2.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(after1[i] ?? 0));
    // The next day starts at nothing.
    const c = makeGame('rig', { now: at(21) }, storage);
    expect(c.game.dailyGoals.map((g) => g.value(c.game.progress))).toEqual([0, 0, 0]);
  });

  it('toast a goal the moment the run finishes it, and list it at game over', () => {
    const storage = memoryStorage();
    // A day with a RIDE goal: riding a metre always counts towards it.
    const d = Array.from({ length: 31 }, (_, i) => i + 1).find((n) =>
      goalDefs(dayString(new Date(2026, 9, n, 12))).some((g) => g.stat === 'dist' && !g.best),
    );
    const { game, input, store } = makeGame('rig', { now: at(d ?? 1) }, storage);
    const day = dayString(new Date(2026, 9, d ?? 1, 12));
    const defs = goalDefs(day);
    // Every goal one step short (a best-run goal at nothing), so the run finishes the add-up ones at once.
    store.progress().goals = { day, values: defs.map((g) => (g.best ? 0 : g.target - 1)), days: 0 };
    const sums = defs.filter((g) => !g.best && g.stat === 'dist');
    expect(sums).toHaveLength(1);
    input.push('start');
    const toasts: string[] = [];
    stepUntil(game, () => {
      const t = game.toasts[0];
      if (t?.sub && !toasts.includes(t.sub)) toasts.push(t.sub);
      return game.phase === 'over';
    });
    for (const g of sums) expect(toasts).toContain(goalName(g));
    const names = game.result?.goals.map((c) => c.name) ?? [];
    for (const g of sums) expect(names).toContain(goalName(g));
    const i = defs.findIndex((g) => g.stat === 'dist' && !g.best);
    expect(store.progress().goals.values[i]).toBeGreaterThanOrEqual(defs[i]?.target ?? Infinity);
  });
});

/** Ride a bot until it crashes or reaches `metres`, counting what goals count. */
function botRun(seed: string, metres: number, pick: (sim: Sim, air: number) => SimInput): RunTally {
  const sim = new Sim(seed);
  sim.begin();
  const counts: EventCounts = { grabs: 0, lines: 0 };
  let air = 0;
  for (let i = 0; i < 400_000 && !sim.crashed && sim.distM < metres; i++) {
    air = sim.rider.air ? air + 1 : 0;
    sim.step(pick(sim, air));
    for (const e of sim.events) countEvent(counts, e);
  }
  return summarizeRun(sim, seed, false, counts);
}

/** Takes stars: aims at the next one close ahead, else follows the path. Wipes out now and then, as players do. */
function starBot(sim: Sim): SimInput {
  const r = sim.rider;
  if (r.air) return { steer: 0, trick: false };
  const look = 14 + r.speed * 0.2;
  const star = sim.pickups.find((p) => !p.taken && p.y > r.y + 4 && p.y - r.y < 120);
  const tx = star ? star.x : sim.spawner.pathCenter(r.y + 8 + look);
  return {
    steer: Math.max(-1, Math.min(1, (tx - r.x) / (look * 0.55) - r.hv * 0.04)),
    trick: false,
  };
}

/** Takes every kicker, spins once and grabs on the way up, and lets go in good time. */
function trickBot(sim: Sim, air: number): SimInput {
  if (!sim.rider.air) return kickerBotInput(sim);
  return { steer: 0, trick: air === 2, grab: air > 4 && air < 30 };
}

const BOTS: Record<string, (sim: Sim, air: number) => SimInput> = {
  path: (sim) => botInput(sim),
  stars: starBot,
  tricks: trickBot,
};

/** Which bot plays each kind of goal: the one that goes for that thing. */
const BOT_FOR: Record<GoalDef['stat'], string> = {
  dist: 'path',
  score: 'tricks',
  stars: 'stars',
  nearMisses: 'stars',
  tricks: 'tricks',
  landings: 'tricks',
  grabs: 'tricks',
  lines: 'tricks',
  maxCombo: 'stars',
};

/** Runs a tier's goal may take, and how far each run goes at most, so no goal asks for an endless run. */
const BUDGET: Record<GoalTier, { runs: number; metres: number }> = {
  short: { runs: 1, metres: 600 },
  medium: { runs: 3, metres: 900 },
  long: { runs: 6, metres: 1600 },
};

describe('daily goal sizes', () => {
  it('are reachable by bots within each tier’s runs', () => {
    const stuck: string[] = [];
    for (const tier of GOAL_TIERS) {
      const { runs, metres } = BUDGET[tier];
      for (const def of GOAL_POOLS[tier]) {
        const bot = BOTS[BOT_FOR[def.stat]] ?? botInput;
        let v = 0;
        for (let k = 0; k < runs && v < def.target; k++) {
          v = withRun(def, v, botRun(`goal${tier}${k}`, metres, bot));
        }
        if (v < def.target) stuck.push(`${tier} ${goalName(def)}: ${v}`);
      }
    }
    expect(stuck).toEqual([]);
  });
});
