import { describe, expect, it } from 'vitest';
import {
  H,
  LESSON_AHEAD_MAX,
  LESSON_AHEAD_MIN,
  LESSON_GUARD,
  SAVE_PREFIX,
  TUTORIAL_RUNS,
  W,
} from '../src/core/config';
import { textWidth } from '../src/render/font';
import { lessonTarget, lessonTop, LESSON_LINE } from '../src/render/lesson';
import { testObstacle } from '../src/sim/collision';
import type { Obstacle, ObstacleKind } from '../src/sim/types';
import type { Game } from '../src/state/game';
import {
  ALL_LESSONS,
  LESSON_ORDER,
  lessonLines,
  lessonSeen,
  nextLesson,
  type LessonId,
} from '../src/state/tutorial';
import { botInput } from './helpers/bot';
import { makeGame, memoryStorage } from './helpers/fakes';

const STEP = 1 / 120;

/** A brand new player's game, the run started. */
function newPlayer(seed: string, storage = memoryStorage()): ReturnType<typeof makeGame> {
  const rig = makeGame(seed, {}, storage, { tutorial: true });
  rig.input.push('start');
  rig.game.update(STEP);
  return rig;
}

/** Ride a bot down the slope, going on from every lesson once it may, and note each lesson as it comes up. */
function rideThrough(
  rig: ReturnType<typeof makeGame>,
  steps: number,
): Array<{ id: LessonId; ahead: number; game: Game }> {
  const { game, input } = rig;
  const shown: Array<{ id: LessonId; ahead: number; game: Game }> = [];
  let last: unknown = null;
  for (let i = 0; i < steps && game.phase === 'playing'; i++) {
    const lesson = game.lesson;
    if (lesson && lesson !== last) {
      last = lesson;
      const t = lesson.target;
      const list = t ? (game.sim[t.list] as ReadonlyArray<{ id: number; y: number }>) : [];
      const thing = t ? list.find((e) => e.id === t.id) : undefined;
      shown.push({ id: lesson.id, ahead: thing ? thing.y - game.sim.rider.y : 0, game });
    }
    if (lesson) {
      for (let k = 0; k * STEP < LESSON_GUARD; k++) game.update(STEP);
      input.tap(90, 200);
    } else {
      input.steerValue = botInput(game.sim).steer;
    }
    game.update(STEP);
  }
  return shown;
}

describe('the first-run tutorial', () => {
  it('stops a new player at the start to teach steering, and holds the run still while it is up', () => {
    const { game, input } = newPlayer('tut');
    expect(game.phase).toBe('playing');
    expect(game.lesson?.id).toBe('steer');
    const y = game.sim.rider.y;
    const t = game.animT;
    input.steerValue = 1;
    for (let i = 0; i < 240; i++) game.update(STEP);
    expect(game.sim.rider.y).toBe(y);
    expect(game.animT).toBe(t);
    expect(game.lesson?.id).toBe('steer');
  });

  it('goes on at a tap or Space, but not at a tap that lands before the lesson can have been read', () => {
    for (const go of ['tap', 'space'] as const) {
      const { game, input } = newPlayer('tut');
      const press = (): void => (go === 'tap' ? input.tap(90, 200) : input.push('start'));
      press();
      game.update(STEP);
      expect(game.lesson?.id).toBe('steer');
      for (let i = 0; i * STEP < LESSON_GUARD; i++) game.update(STEP);
      input.push('left');
      game.update(STEP);
      expect(game.lesson?.id).toBe('steer');
      press();
      game.update(STEP);
      expect(game.lesson).toBeNull();
      const y = game.sim.rider.y;
      for (let i = 0; i < 60; i++) game.update(STEP);
      expect(game.sim.rider.y).toBeGreaterThan(y);
    }
  });

  it('teaches every lesson once over a new player first runs, each when its thing is in reach ahead', () => {
    const seen = new Map<LessonId, number>();
    const offenders: string[] = [];
    for (const seed of ['tut', 'tut-2', 'tut-3', 'tut-4']) {
      for (const s of rideThrough(newPlayer(seed), 120 * 120)) {
        seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
        if (s.id !== 'steer' && (s.ahead < LESSON_AHEAD_MIN || s.ahead > LESSON_AHEAD_MAX)) {
          offenders.push(`${seed} ${s.id} ${s.ahead}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // every seed is a new player, so each lesson comes once per seed
    for (const id of LESSON_ORDER) expect(seen.get(id), id).toBe(4);
  });

  it('never shows a lesson twice, and remembers them across visits', () => {
    const storage = memoryStorage();
    const first = rideThrough(newPlayer('tut', storage), 120 * 120).map((s) => s.id);
    expect(new Set(first).size).toBe(first.length);
    // a new page on the same device: the lessons already shown stay shown
    const again = rideThrough(newPlayer('tut-2', storage), 120 * 120).map((s) => s.id);
    expect(again.filter((id) => first.includes(id))).toEqual([]);
  });

  it('leaves returning players alone', () => {
    const storage = memoryStorage();
    storage.setItem(`${SAVE_PREFIX}progress`, JSON.stringify({ stats: { runs: TUTORIAL_RUNS } }));
    const rig = makeGame('tut', {}, storage, { tutorial: true });
    expect(rig.store.progress().stats.runs).toBe(TUTORIAL_RUNS);
    rig.input.push('start');
    rig.game.update(STEP);
    expect(rig.game.lesson).toBeNull();
    expect(rideThrough(rig, 120 * 60)).toEqual([]);
  });

  it('plays the same run with or without the lessons', () => {
    const plain = makeGame('tut-same');
    const taught = makeGame('tut-same', {}, memoryStorage(), { tutorial: true });
    for (const rig of [plain, taught]) rig.input.push('start');
    // The rider's place after every sim step, steered by the sim's own step count, so time spent on a lesson counts
    // for nothing.
    const ride = (rig: ReturnType<typeof makeGame>): number[] => {
      const out: number[] = [];
      const sim = rig.game.sim;
      for (let i = 0; sim.steps < 120 * 40 && rig.game.phase !== 'over' && i < 120 * 200; i++) {
        if (rig.game.lesson) {
          for (let k = 0; k * STEP < LESSON_GUARD; k++) rig.game.update(STEP);
          rig.input.tap(90, 200);
        }
        rig.input.steerValue = Math.sin(sim.steps / 50);
        const before = sim.steps;
        rig.game.update(STEP);
        if (sim.steps !== before) out.push(sim.steps, sim.rider.x, sim.rider.y);
      }
      return out;
    };
    const a = ride(taught);
    expect(taught.game.progress.stats.lessons).not.toBe(0);
    expect(a.length).toBeGreaterThan(3000);
    expect(a).toEqual(ride(plain));
  });

  it('marks the thing a lesson is about and keeps its words off it and inside the frame', () => {
    const offenders: string[] = [];
    // Look at each lesson as it comes up, before going on from it.
    for (const seed of ['tut', 'tut-2', 'tut-3', 'tut-4']) {
      const { game, input } = newPlayer(seed);
      for (let i = 0; i < 120 * 120 && game.phase === 'playing'; i++) {
        const lesson = game.lesson;
        if (lesson) {
          const box = lessonTarget(game);
          const rows = lesson.lines.length * LESSON_LINE + 10;
          const top = lessonTop(game, rows);
          if (lesson.target && !box) offenders.push(`${seed} ${lesson.id}: no box`);
          if (box && (box.y < 0 || box.y + box.h > H))
            offenders.push(`${seed} ${lesson.id}: off screen`);
          if (box && top < box.y + box.h && box.y < top + rows) {
            offenders.push(`${seed} ${lesson.id}: words over the thing`);
          }
          if (top < 0 || top + rows > H) offenders.push(`${seed} ${lesson.id}: words off screen`);
          for (let k = 0; k * STEP < LESSON_GUARD; k++) game.update(STEP);
          input.tap(90, 200);
        } else {
          input.steerValue = botInput(game.sim).steer;
        }
        game.update(STEP);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fits every lesson line across the frame in big letters', () => {
    for (const id of LESSON_ORDER) {
      for (const touch of [true, false]) {
        for (const line of lessonLines(id, touch))
          expect(textWidth(line, 2), line).toBeLessThanOrEqual(W - 4);
      }
    }
  });

  it('points the crash lesson at trees and rocks that really end the run, and never at a bush', () => {
    const obstacle = (kind: ObstacleKind, size: number): Obstacle => ({
      id: 7,
      kind,
      size,
      variant: 0,
      x: 100,
      y: 400,
      half: 9,
      judged: false,
    });
    for (const [kind, size] of [
      ['tree', 22],
      ['dead', 18],
      ['rock', 14],
      ['bush', 1],
    ] as const) {
      const o = obstacle(kind, size);
      const sim = { rider: { y: 300 }, obstacles: [o], pickups: [], ramps: [] };
      const lesson = nextLesson(sim as never, 0, true);
      const hit = testObstacle({ x: 100, y: 392 }, o);
      expect(hit, kind).toBe('crash');
      // A bush crashes too, but the lesson names trees and rocks, so it is never the one marked.
      expect(lesson?.id, kind).toBe(kind === 'bush' ? undefined : 'crash');
    }
  });

  it('counts every lesson in the all-seen mask', () => {
    for (const id of LESSON_ORDER) expect(lessonSeen(ALL_LESSONS, id)).toBe(true);
    expect(LESSON_ORDER.some((id) => lessonSeen(0, id))).toBe(false);
  });
});
