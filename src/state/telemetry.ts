import { BEST_CLOSE, SESSION_GAP_MS } from '../core/config';
import type { DareEnd } from '../core/dare';
import type { AnalyticsEvent, EventData } from '../platform/analytics';
import type { ShareVia } from '../platform/shareDom';
import type { Kit } from './progress';
import type { LessonId } from './tutorial';

/**
 * The analytics events the game sends, built from plain numbers into coarse bands. Pure: no seed, no dare code, no
 * score or distance to the point, no exact time and no stored identifier ever goes in. Every value is a short label
 * from a fixed set. Properties are in order of importance, because Vercel may only keep the first two (see
 * `ANALYTICS_MAX_PROPS`); PostHog gets them all. `withContext` adds the three that every event carries.
 */

/** How a run is played: the kit, and the course (a friend's dare, the tutorial's, today's daily or a random one). */
export interface RunSetup {
  kit: Kit;
  daily: boolean;
  dare: boolean;
  tutorial: boolean;
}

export type RunMode = 'normal' | 'daily' | 'dare' | 'tutorial';

/** A run on a friend's dare link is "dare", even on a daily course, since that is what brought the player to it. */
export function runMode(s: RunSetup): RunMode {
  if (s.dare) return 'dare';
  if (s.tutorial) return 'tutorial';
  return s.daily ? 'daily' : 'normal';
}

export function kitLabel(kit: Kit): 'board' | 'skis' {
  return kit === 'skis' ? 'skis' : 'board';
}

/** `value` placed in the band of `edges` (ascending), for example "100-249", or "3" for a band of one. */
function band(value: number, edges: readonly number[]): string {
  const v = Math.max(0, Math.floor(value));
  for (let i = edges.length - 1; i >= 0; i--) {
    const lo = edges[i] ?? 0;
    if (v >= lo) {
      const hi = edges[i + 1];
      if (hi === undefined) return `${lo}+`;
      return hi - 1 === lo ? String(lo) : `${lo}-${hi - 1}`;
    }
  }
  return String(edges[0] ?? 0);
}

/** The label of the band `value` falls in: `labels[i]` for `edges[i] <= value < edges[i + 1]`. */
function named(value: number, edges: readonly number[], labels: readonly string[]): string {
  let at = 0;
  for (let i = 0; i < edges.length; i++) if (value >= (edges[i] ?? 0)) at = i;
  return labels[at] ?? labels[0] ?? '';
}

const DIST_EDGES = [0, 100, 250, 500, 1000, 2000, 5000];
const RUN_EDGES = [1, 2, 3, 4, 6, 11];
/** Retention buckets: day 1, 7 and 30 stand alone so D1, D7 and D30 can be read off directly. */
const DAY_EDGES = [0, 1, 2, 7, 8, 30, 31];
const TRIES_EDGES = [1, 2, 4];
const TUT_RUN_EDGES = [1, 2, 3, 4];
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const LOAD_EDGES = [0, SECOND, 2 * SECOND, 4 * SECOND, 8 * SECOND];
const LOAD_LABELS = ['<1s', '1-2s', '2-4s', '4-8s', '8s+'];
const LENGTH_EDGES = [0, MINUTE, 3 * MINUTE, 10 * MINUTE, 30 * MINUTE];
const LENGTH_LABELS = ['<1m', '1-3m', '3-10m', '10-30m', '30m+'];

/** Distance band in metres, for example "250-499". */
export function distBucket(metres: number): string {
  return band(metres, DIST_EDGES);
}

/** A run count: "1", "2", "3", "4-5", "6-10", "11+". */
export function runBucket(n: number): string {
  return band(n, RUN_EDGES);
}

/** Days since the first play: "0", "1", "2-6", "7", "8-29", "30", "31+". */
export function dayBucket(days: number): string {
  return band(days, DAY_EDGES);
}

/** Tries at one dare: "1", "2-3", "4+". */
export function triesBucket(n: number): string {
  return band(n, TRIES_EDGES);
}

/** How long the page took to be playable, from a millisecond count: "<1s" up to "8s+". */
export function loadBucket(ms: number): string {
  return named(ms, LOAD_EDGES, LOAD_LABELS);
}

/** How long a session was, from a millisecond count: "<1m", "1-3m", "3-10m", "10-30m", "30m+". */
export function lengthBucket(ms: number): string {
  return named(ms, LENGTH_EDGES, LENGTH_LABELS);
}

/** A local day (`YYYY-MM-DD`, as `dayString` writes it) as a day number, or null for anything else. */
function dayNumber(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Whole days from `first` to `today`, both `YYYY-MM-DD`; 0 when the first day is unknown or later. */
export function daysSince(first: string, today: string): number {
  const a = dayNumber(first);
  const b = dayNumber(today);
  return a === null || b === null ? 0 : Math.max(0, b - a);
}

/** The ISO week a day falls in, for example "2026-W46" (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(day: string): string {
  const n = dayNumber(day);
  if (n === null) return '';
  const d = new Date(n * 86_400_000);
  const weekday = (d.getUTCDay() + 6) % 7;
  // The Thursday of this week decides the year.
  d.setUTCDate(d.getUTCDate() - weekday + 3);
  const year = d.getUTCFullYear();
  const week = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Who is playing, carried by every event. Nothing in it is stored for analytics or tells two players apart. */
export interface PlayerContext {
  /** "new" when this visit is the first time this device has played (nothing saved yet), else "returning". */
  player: 'new' | 'returning';
  /** The first play day (`Stats.firstDay`, empty before the first run) and today: sent as the days between them. */
  firstDay: string;
  today: string;
  /** "dare" when this visit opened from a shared link, for every event of the visit. */
  source: 'direct' | 'dare';
}

/** The event with the shared context after its own properties. */
export function withContext(e: AnalyticsEvent, c: PlayerContext): AnalyticsEvent {
  return {
    name: e.name,
    data: {
      ...e.data,
      player: c.player,
      days_since_first: dayBucket(daysSince(c.firstDay, c.today)),
      source: c.source,
    },
  };
}

function event(name: string, data: EventData): AnalyticsEvent {
  return { name, data };
}

/** How the page was opened. */
export type Landing = 'home' | 'dare' | 'broken_dare' | 'old_link';

/** The page is playable: the denominator of every funnel. `loadMs` is the time from navigation to the first frame. */
export function gameLoadedEvent(loadMs: number, landing: Landing): AnalyticsEvent {
  return event('Game Loaded', { landing, load_time: loadBucket(loadMs) });
}

/**
 * The first event of a local day in this visit. Counting these by `days_since_first` for one `cohort_week` gives
 * retention with no identifier (day 1 over day 0 is D1). `firstDay` is empty before the first run, so it is today.
 */
export function dayActiveEvent(firstDay: string, today: string): AnalyticsEvent {
  return event('Day Active', {
    cohort_week: isoWeek(dayNumber(firstDay) === null ? today : firstDay),
  });
}

/** Which tutorial run this is, from the finished runs before it: "1", "2", "3" (the tutorial has `TUTORIAL_RUNS`). */
function tutRun(runsBefore: number): string {
  return band(runsBefore + 1, TUT_RUN_EDGES);
}

export function lessonShownEvent(lesson: LessonId, runsBefore: number): AnalyticsEvent {
  return event('Lesson Shown', { lesson, tut_run: tutRun(runsBefore) });
}

/** The player went on from a lesson (a crash under a lesson is not this). */
export function lessonDoneEvent(lesson: LessonId, runsBefore: number): AnalyticsEvent {
  return event('Lesson Done', { lesson, tut_run: tutRun(runsBefore) });
}

/** The tutorial is over for good: every lesson shown, or the tutorial runs used up first. */
export function tutorialEndedEvent(result: 'completed' | 'cut_short'): AnalyticsEvent {
  return event('Tutorial Ended', { result });
}

/**
 * A run started. `lifeRun` is which run of the player's life it is (finished runs before it, plus one), `visitRun`
 * which run of this page load.
 */
export function runStartedEvent(
  setup: RunSetup,
  lifeRun: number,
  visitRun: number,
): AnalyticsEvent {
  return event('Run Started', {
    mode: runMode(setup),
    kit: kitLabel(setup.kit),
    life_run: runBucket(lifeRun),
    visit_run: runBucket(visitRun),
  });
}

/** How the run stopped: a crash, the player quitting it (QUIT, MENU, RESTART, RETRY) or leaving the page. */
export type RunEnd = 'crash' | 'quit' | 'left';
/** What ended it: an obstacle kind or a bail, or "none" for a run that was quit or left before any crash. */
export type RunCause = DareEnd | 'none';
/** The score against the best before it: a new best, within `BEST_CLOSE` of it, or neither. */
export type BestBand = 'new' | 'close' | 'no';

export function bestBand(score: number, bestBefore: number, newBest: boolean): BestBand {
  if (newBest) return 'new';
  return bestBefore > 0 && score >= bestBefore * BEST_CLOSE ? 'close' : 'no';
}

export interface RunEndInfo {
  end: RunEnd;
  cause: RunCause;
  metres: number;
  best: BestBand;
  setup: RunSetup;
  lifeRun: number;
}

/** A run ended, however it ended. Distance in a band, never the score itself. */
export function runEndedEvent(r: RunEndInfo): AnalyticsEvent {
  return event('Run Ended', {
    metres: distBucket(r.metres),
    end: r.end,
    best: r.best,
    cause: r.cause,
    mode: runMode(r.setup),
    life_run: runBucket(r.lifeRun),
  });
}

/** What the player did first from the game over screen, and anything else they did there. */
export type NextAction = 'again' | 'retry' | 'share' | 'menu';

export function nextActionEvent(action: NextAction): AnalyticsEvent {
  return event('Next Action', { action });
}

/** How a run on a dare went against the friend's score. */
export type DareOutcome = 'beat' | 'tied' | 'short';

export function dareOutcome(score: number, dareScore: number): DareOutcome {
  if (score > dareScore) return 'beat';
  return score === dareScore ? 'tied' : 'short';
}

/** A run on a friend's dare finished. `tries` counts runs at this dare in this visit. */
export function dareResultEvent(outcome: DareOutcome, tries: number): AnalyticsEvent {
  return event('Dare Result', { outcome, tries: triesBucket(tries) });
}

/** The player shared a run, which way it went, and how it did if it was a run on a dare. */
export function runSharedEvent(
  via: ShareVia,
  mode: RunMode,
  dare: DareOutcome | 'none',
): AnalyticsEvent {
  return event('Run Shared', { via, mode, dare_result: dare });
}

/** A run earned an achievement or unlocked gear. The id is from the game's fixed lists. */
export function unlockEarnedEvent(kind: 'achievement' | 'gear', id: string): AnalyticsEvent {
  return event('Unlock Earned', { kind, id });
}

/**
 * Analytics sessions, measured on the page's own clock (milliseconds) and never stored. One starts when the page
 * loads, and again when it comes back after `SESSION_GAP_MS` or more hidden. Each time the page is hidden it sends
 * Session Ended with the runs and the visible time so far; a session the player came back to within the gap sends
 * another one later, marked `resumed: yes`, so count sessions by `resumed: no`.
 */
export class Session {
  private visibleMs = 0;
  private shownAt: number | null;
  private hiddenAt: number | null = null;
  private runsAtStart: number;
  private ends = 0;

  constructor(now: number, runs: number) {
    this.shownAt = now;
    this.runsAtStart = runs;
  }

  /** The page was hidden after `runs` runs in this visit: the session so far. Null if it was hidden already. */
  hide(now: number, runs: number): AnalyticsEvent | null {
    if (this.shownAt === null) return null;
    this.visibleMs += Math.max(0, now - this.shownAt);
    this.shownAt = null;
    this.hiddenAt = now;
    const e = event('Session Ended', {
      runs: band(runs - this.runsAtStart, [0, 1, 2, 3, 4, 6, 11]),
      length: lengthBucket(this.visibleMs),
      resumed: this.ends > 0 ? 'yes' : 'no',
    });
    this.ends++;
    return e;
  }

  /** The page is back: the same session after a short break, a new one after `SESSION_GAP_MS`. */
  show(now: number, runs: number): void {
    if (this.shownAt !== null) return;
    if (this.hiddenAt !== null && now - this.hiddenAt >= SESSION_GAP_MS) {
      this.visibleMs = 0;
      this.runsAtStart = runs;
      this.ends = 0;
    }
    this.shownAt = now;
    this.hiddenAt = null;
  }
}
