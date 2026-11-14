import type { AnalyticsEvent } from '../platform/analytics';
import type { ShareVia } from '../platform/shareDom';
import type { Kit } from './progress';

/**
 * The analytics events the game sends, built from plain numbers into coarse buckets. Pure: no seed, no score to the
 * point, no time and no identifier ever goes in. Properties are in order of importance, because the plan may only
 * keep the first two (see `ANALYTICS_MAX_PROPS`).
 */

/**
 * How a run is played: kit and course, for example "skis daily". A run on a friend's dare link is "dare", even on a
 * daily course, since that is what brought the player to it.
 */
export interface RunSetup {
  kit: Kit;
  daily: boolean;
  dare: boolean;
}

export function setupLabel(s: RunSetup): string {
  const course = s.dare ? 'dare' : s.daily ? 'daily' : 'normal';
  return `${s.kit === 'skis' ? 'skis' : 'board'} ${course}`;
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

const DIST_EDGES = [0, 100, 250, 500, 1000, 2000, 5000];
const SCORE_EDGES = [0, 100, 500, 1000, 2500, 5000, 10000, 25000];
const RUN_EDGES = [1, 2, 3, 4, 6, 11];

/** Distance band in metres, for example "250-499". */
export function distBucket(metres: number): string {
  return band(metres, DIST_EDGES);
}

export function scoreBucket(score: number): string {
  return band(score, SCORE_EDGES);
}

/** Which run of this visit: "1", "2", "3", "4-5", "6-10", "11+". Run 2 over run 1 is the second-run rate. */
export function runBucket(n: number): string {
  return band(n, RUN_EDGES);
}

/** A run started. `n` counts runs since the page loaded (1 for the first). */
export function runStartEvent(n: number, setup: RunSetup): AnalyticsEvent {
  return { name: 'Run Start', data: { run: runBucket(n), setup: setupLabel(setup) } };
}

/** A run ended on the game over screen. */
export function runEndEvent(
  metres: number,
  score: number,
  n: number,
  setup: RunSetup,
): AnalyticsEvent {
  return {
    name: 'Run End',
    data: {
      metres: distBucket(metres),
      score: scoreBucket(score),
      setup: setupLabel(setup),
      run: runBucket(n),
    },
  };
}

/** The player shared a result, and which way it went (Web Share with the image or the link, clipboard, download). */
export function shareEvent(via: ShareVia): AnalyticsEvent {
  return { name: 'Share', data: { via } };
}
