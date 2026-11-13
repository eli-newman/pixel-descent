import {
  LESSON_AHEAD_MAX,
  LESSON_AHEAD_MIN,
  LESSON_FREE_RIDE,
  START_Y,
  TUTORIAL_RUNS,
} from '../core/config';
import { isPebble } from '../sim/collision';
import type { SimView } from './view';

/**
 * The first-run tutorial: instead of labels floating over the slope, the run stops the first time each kind of thing
 * comes up, marks it, says in a few big words what it does and goes on at a tap. Each lesson shows once ever, and
 * only on a player's first `TUTORIAL_RUNS` runs. The sim is not stepped while a lesson is up, so a run plays out the
 * same with or without it.
 */
export type LessonId = 'steer' | 'crash' | 'slow' | 'star' | 'jump';

/** What a lesson points at: a thing on the slope by its list and id, or nothing (the steering lesson). */
export interface LessonTarget {
  list: 'obstacles' | 'patches' | 'pickups' | 'ramps';
  id: number;
}

export interface Lesson {
  id: LessonId;
  /** Big words: two or three lines that fit across the frame at twice the font size. */
  lines: readonly string[];
  target: LessonTarget | null;
}

/** One bit per lesson in `Stats.lessons`, in the order a run usually meets them. */
export const LESSON_ORDER: readonly LessonId[] = ['steer', 'crash', 'slow', 'star', 'jump'];
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

/** The words of each lesson, for a touch screen or a keyboard. */
export function lessonLines(id: LessonId, touch: boolean): readonly string[] {
  switch (id) {
    case 'steer':
      return [touch ? 'HOLD A SIDE TO STEER' : 'A AND D TO STEER', 'HOLD BOTH TO BRAKE'];
    case 'crash':
      return ['TREES AND ROCKS', 'END YOUR RUN'];
    case 'slow':
      return ['BUSHES AND DEEP', 'SNOW SLOW YOU DOWN'];
    case 'star':
      return ['GRAB STARS', 'FOR POINTS'];
    case 'jump':
      return touch
        ? ['RIDE OVER JUMPS', 'SWIPE TO SPIN OR FLIP', 'TAP TO GRAB']
        : ['RIDE OVER JUMPS', 'SPACE SPIN  W S FLIP', 'X TO GRAB'];
  }
}

/** Whether a thing at world y `y` sits where a lesson about it should stop the run. */
function inReach(sim: SimView, y: number): boolean {
  const ahead = y - sim.rider.y;
  return ahead >= LESSON_AHEAD_MIN && ahead <= LESSON_AHEAD_MAX;
}

/**
 * The lesson to stop the run for right now, if any: the nearest thing ahead in reach whose lesson has not been
 * shown, once the rider is `LESSON_FREE_RIDE` px down the slope. Steering is taught at the start of the run, not here.
 */
export function nextLesson(sim: SimView, seen: number, touch: boolean): Lesson | null {
  if (sim.rider.y < START_Y + LESSON_FREE_RIDE) return null;
  const things: Array<{ id: LessonId; target: LessonTarget; y: number }> = [];
  for (const o of sim.obstacles) {
    if (isPebble(o.kind, o.size)) continue;
    things.push({
      id: o.kind === 'bush' ? 'slow' : 'crash',
      target: { list: 'obstacles', id: o.id },
      y: o.y,
    });
  }
  for (const p of sim.patches)
    things.push({ id: 'slow', target: { list: 'patches', id: p.id }, y: p.y });
  for (const p of sim.pickups) {
    if (!p.taken) things.push({ id: 'star', target: { list: 'pickups', id: p.id }, y: p.y });
  }
  for (const r of sim.ramps) {
    if (!r.used) things.push({ id: 'jump', target: { list: 'ramps', id: r.id }, y: r.y });
  }
  let best: { id: LessonId; target: LessonTarget; y: number } | null = null;
  for (const t of things) {
    if (lessonSeen(seen, t.id) || !inReach(sim, t.y)) continue;
    if (!best || t.y < best.y) best = t;
  }
  return best ? { id: best.id, lines: lessonLines(best.id, touch), target: best.target } : null;
}
