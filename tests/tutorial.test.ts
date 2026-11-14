import { describe, expect, it } from 'vitest';
import {
  H,
  LESSON_AHEAD_MAX,
  LESSON_AHEAD_MIN,
  LESSON_EASE_IN,
  LESSON_EASE_OUT,
  LESSON_FIRST,
  LESSON_GAP,
  LESSON_GUARD,
  SAVE_PREFIX,
  TUTORIAL_RUNS,
  TUTORIAL_SEED,
  W,
} from '../src/core/config';
import { textWidth } from '../src/render/font';
import { lessonRows, lessonTarget, lessonTop } from '../src/render/lesson';
import { testObstacle } from '../src/sim/collision';
import type { Obstacle, ObstacleKind } from '../src/sim/types';
import type { Game } from '../src/state/game';
import {
  ALL_LESSONS,
  LESSON_ORDER,
  lessonSeen,
  lessonText,
  markSeen,
  nextLesson,
  type LessonId,
} from '../src/state/tutorial';
import type { Sim } from '../src/sim/sim';
import { botInput, kickerBotInput } from './helpers/bot';
import { makeGame, memoryStorage, stepUntil } from './helpers/fakes';

function stepToOver(game: Game): void {
  stepUntil(game, () => game.phase === 'over');
  stepUntil(game, () => game.overReady);
}

const STEP = 1 / 120;

/** A brand new player's game, the run started. */
function newPlayer(seed: string, storage = memoryStorage()): ReturnType<typeof makeGame> {
  const rig = makeGame(seed, {}, storage, { tutorial: true });
  rig.input.push('start');
  rig.game.update(STEP);
  return rig;
}

/** Step until a lesson has stopped the run and a tap would go on, as a player who reads it would. */
function waitToGoOn(game: Game): void {
  for (let k = 0; k < 120 * 10 && !game.lessonReady; k++) game.update(STEP);
}

/** Step a new player's run, riding straight, until the steering lesson has stopped it. */
function untilSteer(rig: ReturnType<typeof makeGame>): void {
  for (let k = 0; k < 120 * 10 && !rig.game.lesson; k++) rig.game.update(STEP);
  waitToGoOn(rig.game);
}

interface Shown {
  id: LessonId;
  /** The thing's distance ahead of the rider once the run has stopped for it. */
  ahead: number;
  /** Seconds of the run when the lesson came, and when the player went on from it. */
  at: number;
  went: number;
}

type Rider = (sim: Sim, step: number) => { steer: number; brake: boolean };

/** Ride a bot down the slope, going on from every lesson once it may, and note each lesson as it comes up. */
function rideThrough(
  rig: ReturnType<typeof makeGame>,
  steps: number,
  rider: Rider = (sim) => ({ steer: botInput(sim).steer, brake: false }),
): Shown[] {
  const { game, input } = rig;
  const shown: Shown[] = [];
  for (let i = 0; i < steps && game.phase === 'playing'; i++) {
    const lesson = game.lesson;
    if (lesson && game.lessonWaiting) {
      const at = game.sim.runTime;
      waitToGoOn(game);
      const t = lesson.target;
      const list = t ? (game.sim[t.list] as ReadonlyArray<{ id: number; y: number }>) : [];
      const thing = t ? list.find((e) => e.id === t.id) : undefined;
      shown.push({
        id: lesson.id,
        ahead: thing ? thing.y - game.sim.rider.y : 0,
        at,
        went: game.sim.runTime,
      });
      input.tap(90, 200);
    } else {
      const r = rider(game.sim, i);
      input.steerValue = r.steer;
      input.brakeValue = r.brake;
    }
    game.update(STEP);
  }
  return shown;
}

describe('the first-run tutorial', () => {
  it('lets a new player ride first, then slows the run to a stop to teach steering and holds it there', () => {
    const { game, input } = newPlayer('tut');
    expect(game.phase).toBe('playing');
    expect(game.lesson).toBeNull();
    for (let k = 0; game.sim.runTime < LESSON_FIRST - 0.05; k++) game.update(STEP);
    expect(game.lesson).toBeNull();
    untilSteer({ game, input } as ReturnType<typeof makeGame>);
    expect(game.lesson?.id).toBe('steer');
    expect(game.sim.runTime).toBeGreaterThanOrEqual(LESSON_FIRST);
    const y = game.sim.rider.y;
    const t = game.animT;
    input.steerValue = 1;
    for (let i = 0; i < 240; i++) game.update(STEP);
    expect(game.sim.rider.y).toBe(y);
    expect(game.animT).toBe(t);
    expect(game.lesson?.id).toBe('steer');
  });

  it('eases the run down to a stop and back up, never jumping', () => {
    const { game, input } = newPlayer('tut');
    for (let k = 0; k < 120 * 10 && !game.lesson; k++) game.update(STEP);
    // Steps per frame, as the run slows down: falling from one to none, the words fading in as it goes.
    const steps: number[] = [];
    const shows: number[] = [];
    for (let k = 0; k * STEP < LESSON_EASE_IN + 0.1; k++) {
      const before = game.sim.steps;
      game.update(STEP);
      steps.push(game.sim.steps - before);
      shows.push(game.lessonShow);
    }
    const firstHalf = steps.slice(0, steps.length / 4).reduce((a, b) => a + b, 0);
    const lastHalf = steps.slice((steps.length * 3) / 4).reduce((a, b) => a + b, 0);
    expect(firstHalf).toBeGreaterThan(lastHalf);
    expect(lastHalf).toBe(0);
    expect(shows.every((v, i) => i === 0 || v >= (shows[i - 1] ?? 0))).toBe(true);
    expect(shows.at(-1)).toBe(1);
    // Going on, it picks up speed again while the words fade out, then the lesson is gone.
    waitToGoOn(game);
    input.tap(90, 200);
    game.update(STEP);
    expect(game.lessonWaiting).toBe(false);
    expect(game.lesson).not.toBeNull();
    const before = game.sim.steps;
    for (let k = 0; k * STEP < LESSON_EASE_OUT + 0.05; k++) game.update(STEP);
    expect(game.lesson).toBeNull();
    const moved = game.sim.steps - before;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan((LESSON_EASE_OUT + 0.05) / STEP);
  });

  it('goes on at a tap or Space, but not at a tap that lands before the lesson can have been read', () => {
    for (const go of ['tap', 'space'] as const) {
      const rig = newPlayer('tut');
      const { game, input } = rig;
      for (let k = 0; k < 120 * 10 && !game.lesson; k++) game.update(STEP);
      const press = (): void => (go === 'tap' ? input.tap(90, 200) : input.push('start'));
      press();
      game.update(STEP);
      expect(game.lessonWaiting).toBe(true);
      for (let i = 0; i * STEP < LESSON_GUARD; i++) game.update(STEP);
      expect(game.lessonReady).toBe(true);
      input.push('left');
      game.update(STEP);
      expect(game.lessonWaiting).toBe(true);
      press();
      game.update(STEP);
      expect(game.lessonWaiting).toBe(false);
      const y = game.sim.rider.y;
      for (let i = 0; i < 60; i++) game.update(STEP);
      expect(game.lesson).toBeNull();
      expect(game.sim.rider.y).toBeGreaterThan(y);
    }
  });

  it('starts every new player on the same course, which teaches each lesson in order, one at a time', () => {
    const { game } = makeGame('', {}, memoryStorage(), { tutorial: true });
    expect(game.seed).toBe(TUTORIAL_SEED);
    // Riders who follow the path, look further ahead, take every kicker, or brake a lot.
    const riders: Record<string, Rider> = {
      path: (sim) => ({ steer: botInput(sim).steer, brake: false }),
      far: (sim) => ({ steer: botInput(sim, 0.4).steer, brake: false }),
      kicker: (sim) => ({ steer: kickerBotInput(sim).steer, brake: false }),
      braking: (sim, i) => ({ steer: botInput(sim).steer, brake: i % 240 < 90 }),
    };
    const offenders: string[] = [];
    for (const [name, rider] of Object.entries(riders)) {
      const rig = newPlayer(TUTORIAL_SEED);
      const shown = rideThrough(rig, 120 * 90, rider);
      if (shown.map((s) => s.id).join() !== LESSON_ORDER.join()) {
        offenders.push(`${name}: ${shown.map((s) => s.id).join()}`);
      }
      if (rig.game.phase !== 'playing') offenders.push(`${name}: crashed`);
      for (let i = 1; i < shown.length; i++) {
        const gap = (shown[i]?.at ?? 0) - (shown[i - 1]?.went ?? 0);
        if (gap < LESSON_GAP) offenders.push(`${name}: ${shown[i]?.id} after ${gap.toFixed(2)} s`);
      }
    }
    // Someone who never steers at all still gets past the lesson about crashing before they crash.
    const still = newPlayer(TUTORIAL_SEED);
    const met = rideThrough(still, 120 * 60, () => ({ steer: 0, brake: false }));
    const crash = met.find((s) => s.id === 'crash');
    if (!crash) offenders.push('still: no crash lesson');
    else if (still.game.sim.runTime < crash.went + LESSON_GAP)
      offenders.push('still: crashed straight after');
    expect(offenders).toEqual([]);
  });

  it('goes back to random courses once every lesson has been shown', () => {
    const rig = makeGame('', {}, memoryStorage(), { tutorial: true });
    expect(rig.game.seed).toBe(TUTORIAL_SEED);
    // a crash before the lessons are done: the next run is the tutorial course again
    rig.input.push('start');
    stepToOver(rig.game);
    rig.game.press('again');
    expect(rig.game.seed).toBe(TUTORIAL_SEED);
    rig.store.progress().stats.lessons = ALL_LESSONS;
    stepToOver(rig.game);
    rig.game.press('again');
    expect(rig.game.seed).not.toBe(TUTORIAL_SEED);
  });

  it('teaches every lesson once over a new player first runs, each stopping with its thing in reach ahead', () => {
    const seen = new Map<LessonId, number>();
    const offenders: string[] = [];
    for (const seed of ['tut', 'tut-2', 'tut-3', 'tut-4']) {
      for (const s of rideThrough(newPlayer(seed), 120 * 120)) {
        seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
        // Where the run stops is foreseen from the speed when the lesson comes, so it may land a few px off.
        if (
          s.id !== 'steer' &&
          (s.ahead < LESSON_AHEAD_MIN - 4 || s.ahead > LESSON_AHEAD_MAX + 4)
        ) {
          offenders.push(`${seed} ${s.id} ${s.ahead.toFixed(1)}`);
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
        if (rig.game.lessonReady) rig.input.tap(90, 200);
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
        if (lesson && game.lessonWaiting) {
          waitToGoOn(game);
          const box = lessonTarget(game);
          const rows = lessonRows(lesson);
          const top = lessonTop(game, rows);
          if (lesson.target && !box) offenders.push(`${seed} ${lesson.id}: no box`);
          if (box && (box.y < 0 || box.y + box.h > H))
            offenders.push(`${seed} ${lesson.id}: off screen`);
          if (box && top < box.y + box.h && box.y < top + rows) {
            offenders.push(`${seed} ${lesson.id}: words over the thing`);
          }
          if (top < 0 || top + rows > H) offenders.push(`${seed} ${lesson.id}: words off screen`);
          input.tap(90, 200);
        } else {
          input.steerValue = botInput(game.sim).steer;
        }
        game.update(STEP);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fits every lesson title and line across the frame in big letters', () => {
    for (const id of LESSON_ORDER) {
      for (const touch of [true, false]) {
        const { title, lines } = lessonText(id, touch);
        expect(textWidth(title, 3), title).toBeLessThanOrEqual(W - 8);
        for (const line of lines) expect(textWidth(line, 2), line).toBeLessThanOrEqual(W - 4);
      }
    }
  });

  it('points the crash lesson at trees and rocks that really end the run, and never at a bush or a dead tree', () => {
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
      const sim = {
        runTime: 10,
        rider: { y: 300, speed: 0, hx: 0, air: false },
        obstacles: [o],
        pickups: [],
        ramps: [],
      };
      const lesson = nextLesson(sim as never, markSeen(0, 'steer'), true, 0);
      const hit = testObstacle({ x: 100, y: 392 }, o);
      expect(hit, kind).toBe('crash');
      // A bush and a dead tree crash too, but the lesson shows a pine or a rock, so they are never the one marked.
      expect(lesson?.id, kind).toBe(kind === 'bush' || kind === 'dead' ? undefined : 'crash');
    }
  });

  it('counts every lesson in the all-seen mask', () => {
    for (const id of LESSON_ORDER) expect(lessonSeen(ALL_LESSONS, id)).toBe(true);
    expect(LESSON_ORDER.some((id) => lessonSeen(0, id))).toBe(false);
  });
});
