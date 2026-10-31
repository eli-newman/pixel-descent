import { Game, type GameDeps } from '../../src/state/game';
import type { Action, Input, InputItem } from '../../src/platform/input';
import type { Sfx } from '../../src/platform/audio';
import { Store, type StorageLike } from '../../src/state/storage';

export class FakeInput {
  steerValue = 0;
  brakeValue = false;
  flipValue: -1 | 0 | 1 = 0;
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
  bush(): void {
    this.calls.push('bush');
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
}

export function makeGame(
  seed = 'rig',
  over: Partial<GameDeps> = {},
  storage = memoryStorage(),
): Rig {
  const input = new FakeInput();
  const sfx = new FakeSfx();
  const store = new Store(storage);
  const shared: unknown[] = [];
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
      ...over,
    },
    seed,
  );
  return { game, input, sfx, store, storage, shared };
}

/** Step the game until a condition holds (or a step limit). */
export function stepUntil(game: Game, done: () => boolean, max = 400000): void {
  for (let i = 0; i < max && !done(); i++) game.update(1 / 120);
}
