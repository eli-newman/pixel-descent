import { Game, type GameDeps } from '../../src/state/game';
import type { Action, Input, InputItem } from '../../src/platform/input';
import type { Sfx } from '../../src/platform/audio';
import type { AnalyticsEvent, Tracker } from '../../src/platform/analytics';
import { Store, type StorageLike } from '../../src/state/storage';
import { ALL_LESSONS } from '../../src/state/tutorial';

export class FakeInput {
  steerValue = 0;
  brakeValue = false;
  flipValue: -1 | 0 | 1 = 0;
  grabValue = false;
  air = false;
  usingTouch = false;
  private queue: InputItem[] = [];
  steer(): number {
    return this.steerValue;
  }
  brake(): boolean {
    return this.brakeValue;
  }
  flip(): -1 | 0 | 1 {
    return this.flipValue;
  }
  grab(): boolean {
    return this.grabValue;
  }
  setAir(on: boolean): void {
    this.air = on;
  }
  drain(): InputItem[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  push(action: Action): void {
    this.queue.push({ kind: 'action', action });
  }
  tap(x: number, y: number): void {
    this.queue.push({ kind: 'tap', x, y });
  }
  releaseAll(): void {
    this.steerValue = 0;
    this.brakeValue = false;
    this.grabValue = false;
  }
}

export class FakeSfx {
  muted = false;
  musicOn = false;
  calls: string[] = [];
  setMuted(m: boolean): void {
    this.muted = m;
  }
  setMusic(m: boolean): void {
    this.musicOn = m;
  }
  wake(): void {}
  ride(): void {}
  start(): void {
    this.calls.push('start');
  }
  pickup(): void {
    this.calls.push('pickup');
  }
  nearMiss(): void {
    this.calls.push('near');
  }
  launch(): void {
    this.calls.push('launch');
  }
  trick(): void {
    this.calls.push('trick');
  }
  land(): void {
    this.calls.push('land');
  }
  crash(): void {
    this.calls.push('crash');
  }
}

/** Records analytics events instead of sending them. */
export class FakeTracker implements Tracker {
  events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): void {
    this.events.push(event);
  }
  names(): string[] {
    return this.events.map((e) => e.name);
  }
}

export function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

export interface Rig {
  game: Game;
  input: FakeInput;
  sfx: FakeSfx;
  store: Store;
  storage: ReturnType<typeof memoryStorage>;
  shared: unknown[];
  analytics: FakeTracker;
}

/**
 * A game on a fake device. The rig plays as a player who has had the tutorial (in memory only, nothing is saved), so
 * runs are not stopped by lessons; pass `tutorial: true` to play as a brand new player.
 */
export function makeGame(
  seed = 'rig',
  over: Partial<GameDeps> = {},
  storage = memoryStorage(),
  opts: { tutorial?: boolean } = {},
): Rig {
  const input = new FakeInput();
  const sfx = new FakeSfx();
  const store = new Store(storage);
  if (!opts.tutorial) store.progress().stats.lessons = ALL_LESSONS;
  const shared: unknown[] = [];
  const analytics = new FakeTracker();
  const game = new Game(
    {
      store,
      input: input as unknown as Input,
      sfx: sfx as unknown as Sfx,
      now: () => new Date(2026, 9, 20, 12),
      rand: () => 0.5,
      share: (card) => {
        shared.push(card);
        return Promise.resolve('SHARED');
      },
      analytics,
      ...over,
    },
    seed,
  );
  return { game, input, sfx, store, storage, shared, analytics };
}

/** Step the game until a condition holds (or a step limit). */
export function stepUntil(game: Game, done: () => boolean, max = 400000): void {
  for (let i = 0; i < max && !done(); i++) game.update(1 / 120);
}
