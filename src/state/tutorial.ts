import {
  LESSON_AHEAD_MAX,
  LESSON_AHEAD_MIN,
  LESSON_EASE_IN,
  LESSON_FIRST,
  LESSON_GAP,
  TUTORIAL_RUNS,
  TUTORIAL_SEED,
} from '../core/config';
import { randomSeedString } from '../core/rng';
import { isPebble } from '../sim/collision';
import { headingY } from '../sim/rider';
import type { SimView } from './view';

/**
 * The first-run tutorial: instead of labels floating over the slope, the run slows to a stop the first time each
 * kind of thing comes up, marks it, says in a few big words what it does and goes on at a tap. Each lesson shows
 * once ever, and only on a player's first `TUTORIAL_RUNS` runs. The sim only steps slower or not at all under a
 * lesson, never differently, so a run plays out the same with or without it.
 */
export type LessonId = 'steer' | 'crash' | 'star' | 'jump' | 'cliff';

/** What a lesson points at: a thing on the slope by its list and id, or nothing (the steering lesson). */
export interface LessonTarget {
  list: 'obstacles' | 'pickups' | 'ramps';
  id: number;
}

/** What a lesson says: a one or two word title at three times the font size, and short lines at twice it. */
export interface LessonText {
  title: string;
  lines: readonly string[];
}

export interface Lesson extends LessonText {
  id: LessonId;
  target: LessonTarget | null;
}

/** One bit per lesson in `Stats.lessons`, in the order a run usually meets them. */
export const LESSON_ORDER: readonly LessonId[] = ['steer', 'crash', 'star', 'jump', 'cliff'];
export const ALL_LESSONS = (1 << LESSON_ORDER.length) - 1;

function bit(id: LessonId): number {
  return 1 << LESSON_ORDER.indexOf(id);
}

export function lessonSeen(seen: number, id: LessonId): boolean {
  return (seen & bit(id)) !== 0;
}

export function markSeen(seen: number, id: LessonId): number {
  return seen | bit(id);
}

/** Whether this player still gets lessons at all. */
export function tutorialOn(stats: { readonly runs: number; readonly lessons: number }): boolean {
  return stats.runs < TUTORIAL_RUNS && stats.lessons !== ALL_LESSONS;
}

/** The words of each lesson, for a touch screen or a keyboard. The steering lesson also shows thumbs or keys. */
export function lessonText(id: LessonId, touch: boolean): LessonText {
  switch (id) {
    case 'steer':
      return touch
        ? { title: 'STEER', lines: ['HOLD LEFT OR RIGHT', 'HOLD BOTH TO BRAKE'] }
        : { title: 'STEER', lines: ['HOLD A OR D', 'HOLD BOTH TO BRAKE'] };
    case 'crash':
      return { title: 'WATCH OUT', lines: ['TREES AND ROCKS', 'END YOUR RUN'] };
    case 'star':
      return { title: 'STARS', lines: ['RIDE THROUGH', 'FOR POINTS'] };
    case 'jump':
      return touch
        ? { title: 'JUMPS', lines: ['SWIPE TO SPIN', 'OR FLIP', 'TAP TO GRAB'] }
        : { title: 'JUMPS', lines: ['SPACE TO SPIN', 'W OR S TO FLIP', 'X TO GRAB'] };
    case 'cliff':
      return { title: 'CLIFF', lines: ['BIG AIR', 'LAND IT FOR', 'A BONUS'] };
  }
}

/** The course a new run starts on: the tutorial's own while lessons are left, else a new random one. */
export function freshSeed(stats: { readonly runs: number; readonly lessons: number }): string {
  return tutorialOn(stats) ? TUTORIAL_SEED : randomSeedString();
}

/**
 * Whether a thing at world y `y` sits where a lesson about it should start: the run, slowing to a stop over
 * `LESSON_EASE_IN` (half that time at full speed, with the ease used), stops with it in reach ahead.
 * The rider's speed down the slope carries on through that, so where the run stops is known now.
 */
function inReach(sim: SimView, y: number): boolean {
  const r = sim.rider;
  const ahead = y - r.y - (headingY(r.hx) * r.speed * LESSON_EASE_IN) / 2;
  return ahead >= LESSON_AHEAD_MIN && ahead <= LESSON_AHEAD_MAX;
}

/**
 * When the next lesson may come, in seconds of the run (`Sim.runTime`): `LESSON_FIRST` into it, and `LESSON_GAP`
 * after the last lesson went (`lastEnd`, or null if none has this run).
 */
export function lessonReadyAt(lastEnd: number | null): number {
  return lastEnd === null ? LESSON_FIRST : Math.max(LESSON_FIRST, lastEnd + LESSON_GAP);
}

/**
 * The lesson to slow the run for right now, if any. Nothing comes before `readyAt` (see `lessonReadyAt`). Steering
 * comes first, on its own; after it, the nearest thing ahead in reach whose lesson has not been shown.
 */
export function nextLesson(
  sim: SimView,
  seen: number,
  touch: boolean,
  readyAt: number,
): Lesson | null {
  if (sim.runTime < readyAt || sim.rider.air) return null;
  if (!lessonSeen(seen, 'steer'))
    return { id: 'steer', ...lessonText('steer', touch), target: null };
  const things: Array<{ id: LessonId; target: LessonTarget; y: number }> = [];
  for (const o of sim.obstacles) {
    // The lesson names trees and rocks, so it points at a pine or a rock: never a bush, and never a bare dead tree,
    // which crashes you just the same but is a poor picture of a tree.
    if (isPebble(o.kind, o.size) || o.kind === 'bush' || o.kind === 'dead') continue;
    things.push({ id: 'crash', target: { list: 'obstacles', id: o.id }, y: o.y });
  }
  for (const p of sim.pickups) {
    if (!p.taken) things.push({ id: 'star', target: { list: 'pickups', id: p.id }, y: p.y });
  }
  for (const r of sim.ramps) {
    if (!r.used) {
      things.push({
        id: r.kind === 'cliff' ? 'cliff' : 'jump',
        target: { list: 'ramps', id: r.id },
        y: r.y,
      });
    }
  }
  let best: { id: LessonId; target: LessonTarget; y: number } | null = null;
  for (const t of things) {
    if (lessonSeen(seen, t.id) || !inReach(sim, t.y)) continue;
    if (!best || t.y < best.y) best = t;
  }
  return best ? { id: best.id, ...lessonText(best.id, touch), target: best.target } : null;
}
