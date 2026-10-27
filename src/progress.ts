/** Lifetime stats, achievements, challenges and unlockable gear. Pure data and rules, no storage. */

export interface RunSummary {
  seed: string;
  daily: boolean;
  dist: number;
  score: number;
  stars: number;
  laneStars: number;
  nearMisses: number;
  gates: number;
  tricks: number;
  landings: number;
  maxCombo: number;
  /** Seconds spent near top speed. */
  sendItTime: number;
  /** Fastest speed in px/s. */
  topSpeed: number;
  /** Closest the avalanche got, in px. */
  minGap: number;
  time: number;
  cause: 'obstacle' | 'bail' | 'avalanche';
}

export interface Stats {
  runs: number;
  totalDist: number;
  bestDist: number;
  /** Furthest single run that took no stars at all. */
  bestNoStarDist: number;
  nearMisses: number;
  stars: number;
  laneStars: number;
  tricks: number;
  gates: number;
  dailies: number;
}

export interface Gear {
  board: string;
  rider: string;
}

export interface Progress {
  stats: Stats;
  /** Achievement id to the day it was earned. */
  achievements: Record<string, string>;
  gear: Gear;
}

export function createProgress(): Progress {
  return {
    stats: {
      runs: 0,
      totalDist: 0,
      bestDist: 0,
      bestNoStarDist: 0,
      nearMisses: 0,
      stars: 0,
      laneStars: 0,
      tricks: 0,
      gates: 0,
      dailies: 0,
    },
    achievements: {},
    gear: { board: 'classic', rider: 'classic' },
  };
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Earned by this run (stats already include it). */
  test: (run: RunSummary, p: Progress) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'd250', name: 'WARM UP', desc: 'REACH 250M', test: (r) => r.dist >= 250 },
  { id: 'd1000', name: 'DOWNHILLER', desc: 'REACH 1000M', test: (r) => r.dist >= 1000 },
  { id: 'd2500', name: 'LEGEND', desc: 'REACH 2500M', test: (r) => r.dist >= 2500 },
  { id: 'sendit', name: 'SEND IT', desc: '4S NEAR TOP SPEED', test: (r) => r.sendItTime >= 4 },
  {
    id: 'close10',
    name: 'CLOSE SHAVE',
    desc: '10 CLOSE CALLS IN A RUN',
    test: (r) => r.nearMisses >= 10,
  },
  { id: 'combo5', name: 'COMBO KING', desc: 'HIT A X5 COMBO', test: (r) => r.maxCombo >= 5 },
  { id: 'air', name: 'AIR MAIL', desc: 'LAND A JUMP', test: (r) => r.landings >= 1 },
  { id: 'show', name: 'SHOW OFF', desc: '3 TRICKS IN A RUN', test: (r) => r.tricks >= 3 },
  { id: 'lane', name: 'RISK TAKER', desc: '8 LANE STARS IN A RUN', test: (r) => r.laneStars >= 8 },
  {
    id: 'photo',
    name: 'PHOTO FINISH',
    desc: 'BEAT THE WALL BY 40PX PAST 500M',
    test: (r) => r.dist >= 500 && r.minGap <= 40 && r.cause !== 'avalanche',
  },
];

export interface Challenge {
  id: string;
  name: string;
  target: number;
  value: (p: Progress) => number;
}

export const CHALLENGES: readonly Challenge[] = [
  { id: 'near50', name: '50 CLOSE CALLS', target: 50, value: (p) => p.stats.nearMisses },
  { id: 'nostar', name: '1000M NO LANE STARS', target: 1000, value: (p) => p.stats.bestNoStarDist },
  { id: 'tricks10', name: '10 TRICKS', target: 10, value: (p) => p.stats.tricks },
  { id: 'lane25', name: '25 LANE STARS', target: 25, value: (p) => p.stats.laneStars },
];

export function challengeDone(c: Challenge, p: Progress): boolean {
  return c.value(p) >= c.target;
}

export interface GearDef {
  id: string;
  name: string;
  /** How to unlock it, in words. */
  need: string;
  unlocked: (p: Progress) => boolean;
}

export const BOARDS: readonly GearDef[] = [
  { id: 'classic', name: 'CLASSIC', need: '', unlocked: () => true },
  { id: 'stripe', name: 'STRIPE', need: 'REACH 500M', unlocked: (p) => p.stats.bestDist >= 500 },
  { id: 'dots', name: 'DOTS', need: 'LAND 10 TRICKS', unlocked: (p) => p.stats.tricks >= 10 },
  { id: 'twin', name: 'TWIN TIP', need: 'REACH 2000M', unlocked: (p) => p.stats.bestDist >= 2000 },
];

export const RIDERS: readonly GearDef[] = [
  { id: 'classic', name: 'HELMET', need: '', unlocked: () => true },
  {
    id: 'beanie',
    name: 'BEANIE',
    need: '1000M NO LANE STARS',
    unlocked: (p) => p.stats.bestNoStarDist >= 1000,
  },
  { id: 'scarf', name: 'SCARF', need: '25 LANE STARS', unlocked: (p) => p.stats.laneStars >= 25 },
  { id: 'ears', name: 'EARS', need: '50 CLOSE CALLS', unlocked: (p) => p.stats.nearMisses >= 50 },
];

export function boardIndex(id: string): number {
  return Math.max(
    0,
    BOARDS.findIndex((b) => b.id === id),
  );
}

export function riderIndex(id: string): number {
  return Math.max(
    0,
    RIDERS.findIndex((b) => b.id === id),
  );
}

export interface RunOutcome {
  newAchievements: Achievement[];
  newGear: GearDef[];
}

function addStats(p: Progress, run: RunSummary): void {
  const s = p.stats;
  s.runs += 1;
  s.totalDist += run.dist;
  s.bestDist = Math.max(s.bestDist, run.dist);
  if (run.laneStars === 0) s.bestNoStarDist = Math.max(s.bestNoStarDist, run.dist);
  s.nearMisses += run.nearMisses;
  s.stars += run.stars;
  s.laneStars += run.laneStars;
  s.tricks += run.tricks;
  s.gates += run.gates;
  if (run.daily) s.dailies += 1;
}

/** Fold a finished run into the progress (mutates it) and report what it unlocked. */
export function applyRun(p: Progress, run: RunSummary, day: string): RunOutcome {
  const gearBefore = new Set([...BOARDS, ...RIDERS].filter((g) => g.unlocked(p)).map((g) => g.id));
  addStats(p, run);
  const newAchievements: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id] === undefined && a.test(run, p)) {
      p.achievements[a.id] = day;
      newAchievements.push(a);
    }
  }
  const newGear = [...BOARDS, ...RIDERS].filter((g) => g.unlocked(p) && !gearBefore.has(g.id));
  return { newAchievements, newGear };
}

/** Make sure the equipped gear is something that is actually unlocked. */
export function sanitiseGear(p: Progress): void {
  const board = BOARDS.find((b) => b.id === p.gear.board);
  if (!board || !board.unlocked(p)) p.gear.board = 'classic';
  const rider = RIDERS.find((b) => b.id === p.gear.rider);
  if (!rider || !rider.unlocked(p)) p.gear.rider = 'classic';
}

/** Step to the next unlocked entry of a gear list. */
export function cycleGear(
  list: readonly GearDef[],
  current: string,
  p: Progress,
  dir: 1 | -1,
): string {
  const start = Math.max(
    0,
    list.findIndex((g) => g.id === current),
  );
  for (let i = 1; i <= list.length; i++) {
    const g = list[(start + dir * i + list.length * 2) % list.length];
    if (g && g.unlocked(p)) return g.id;
  }
  return current;
}
