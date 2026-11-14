/**
 * The daily-ride streak: a finished run on the daily course keeps it going for that local day. Missing up to
 * `STREAK_GRACE` days in a row is forgiven; missing more simply starts a new streak at 1 on the next daily run. Pure
 * rules on `Stats`, no storage and no clock: the day comes from the game's injected clock.
 */

import { STREAK_GRACE } from '../core/config';
import type { Stats } from './progress';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A local day as saved: YYYY-MM-DD, like `dayString` in `runReport.ts`. */
export function isDay(v: unknown): v is string {
  return typeof v === 'string' && dayNumber(v) !== null;
}

/**
 * The calendar day number of a YYYY-MM-DD day (days since 1970-01-01), or null if it is not one. Counted from the
 * date alone, never from a clock time, so months, years, leap days and daylight saving changes all come out right.
 */
export function dayNumber(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Reject days that do not exist (2026-02-30 would roll over into March).
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** The local day a daily course belongs to: `d20261020` is 2026-10-20. Null for any other seed. */
export function seedDay(seed: string): string | null {
  const m = /^d(\d{4})(\d{2})(\d{2})$/.exec(seed);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  return dayNumber(day) === null ? null : day;
}

/**
 * Count a finished run on `day` towards the streak (mutates `stats`). Only a run on the daily course counts: today's,
 * or yesterday's for a run that started before midnight, which counts for the day it was ridden. Returns the streak
 * when the run kept it going (or started one) on a day not counted yet, else null.
 */
export function rideStreak(stats: Stats, seed: string, day: string): number | null {
  const ridden = seedDay(seed);
  const today = dayNumber(day);
  if (ridden === null || today === null) return null;
  const n = dayNumber(ridden) ?? today;
  if (today - n < 0 || today - n > 1) return null;
  const last = dayNumber(stats.lastDay);
  if (last !== null && n <= last) return null;
  const kept = last !== null && n - last <= 1 + STREAK_GRACE;
  stats.streak = kept ? stats.streak + 1 : 1;
  stats.lastDay = ridden;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  return stats.streak;
}

/**
 * The streak as it stands on `day`: the saved one while it can still be kept going, 0 once more days have been
 * missed than the grace allows. Reading it never changes the save; the next daily run starts again at 1.
 */
export function liveStreak(stats: Readonly<Stats>, day: string): number {
  const last = dayNumber(stats.lastDay);
  const today = dayNumber(day);
  if (last === null || today === null) return 0;
  return today - last <= 1 + STREAK_GRACE ? stats.streak : 0;
}
