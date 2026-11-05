import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEP } from '../src/core/config';
import { Input } from '../src/platform/input';
import { launch } from '../src/sim/rider';
import { flipName } from '../src/sim/score';
import { Sim, type SimEvent } from '../src/sim/sim';

type Pt = { id: number; x: number; y: number; t: number };

/** Real touch input on a 400 px wide canvas. `clock.t` is the time steer() sees, in event ms. */
function touchInput(clock = { t: 0 }): {
  input: Input;
  down: (p: Pt) => void;
  move: (p: Pt) => void;
  up: (p: Pt) => void;
} {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('Element', class {});
  const input = new Input(
    {
      getBoundingClientRect: () => ({ left: 0, width: 400 }),
    } as unknown as HTMLCanvasElement,
    () => clock.t,
  );
  const fire =
    (type: string) =>
    (p: Pt): void => {
      win.dispatchEvent(
        Object.defineProperties(new Event(type), {
          pointerId: { value: p.id },
          pointerType: { value: 'touch' },
          clientX: { value: p.x },
          clientY: { value: p.y },
          timeStamp: { value: p.t },
          target: { value: null },
        }),
      );
    };
  return { input, down: fire('pointerdown'), move: fire('pointermove'), up: fire('pointerup') };
}

const actions = (input: Input): string[] =>
  input.drain().flatMap((i) => (i.kind === 'action' ? [i.action] : []));

/** A flick sampled every 20 ms, from (x0, y0) by (dx, dy) over `ms`, eased in and out like a thumb. */
function flick(x0: number, y0: number, dx: number, dy: number, ms: number, t0 = 0): Pt[] {
  const pts: Pt[] = [];
  for (let t = 20; t < ms + 20; t += 20) {
    const f = Math.min(1, t / ms);
    const e = f < 0.5 ? 2 * f * f : 1 - (2 - 2 * f) ** 2 / 2;
    pts.push({ id: 1, x: x0 + dx * e, y: y0 + dy * e, t: t0 + t });
  }
  return pts;
}

/**
 * Ride a cliff jump with real touch input: the finger lands `at` ms after takeoff, follows `path`
 * and lifts. Each sim step reads steer() as the game does, and a queued up/down is that step's flip
 * (as Controls sends it: down is 1, up is -1). Returns the landing and how far the rider spun.
 */
function jumpWithTouch(path: Pt[]): {
  land: Extract<SimEvent, { type: 'land' }> | null;
  spun: number;
} {
  const clock = { t: 0 };
  const { input, down, move, up } = touchInput(clock);
  const sim = new Sim('touch-jump', { manualSpin: false });
  sim.begin();
  for (let i = 0; i < 5; i++) sim.step({ steer: 0, trick: false });
  const r = sim.rider;
  r.speed = 150;
  r.hx = 0;
  r.hv = 0;
  launch(r, true);
  const [first, ...rest] = path;
  if (!first) throw new Error('empty path');
  const events: Array<() => void> = [];
  const times: number[] = [];
  events.push(() => down(first));
  times.push(first.t);
  for (const p of rest) {
    events.push(() => move(p));
    times.push(p.t);
  }
  const last = rest[rest.length - 1] ?? first;
  events.push(() => up({ ...last, t: last.t + 10 }));
  times.push(last.t + 10);
  let land: Extract<SimEvent, { type: 'land' }> | null = null;
  let spun = 0;
  for (let i = 0, next = 0; i < 3000 && !land && !sim.crashed; i++) {
    clock.t = i * STEP * 1000;
    while (next < events.length && (times[next] ?? 0) <= clock.t) events[next++]?.();
    const acts = actions(input);
    const flip = acts.includes('down') ? 1 : acts.includes('up') ? -1 : 0;
    sim.step({ steer: input.steer(), trick: acts.includes('trick'), brake: input.brake(), flip });
    spun = Math.max(spun, Math.abs(sim.rider.spin));
    for (const e of sim.events) if (e.type === 'land') land = e;
  }
  input.dispose();
  return { land, spun };
}

describe('touch gestures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cancels the end of a touch so double taps cannot zoom, except on buttons', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    class FakeElement {
      constructor(private readonly isButton: boolean) {}
      closest(): unknown {
        return this.isButton ? this : null;
      }
    }
    vi.stubGlobal('Element', FakeElement);
    const input = new Input({} as HTMLCanvasElement);
    const touchEnd = (target: unknown): Event => {
      const e = new Event('touchend', { cancelable: true });
      Object.defineProperty(e, 'target', { value: target });
      win.dispatchEvent(e);
      return e;
    };
    expect(touchEnd(new FakeElement(false)).defaultPrevented).toBe(true);
    expect(touchEnd(new FakeElement(true)).defaultPrevented).toBe(false);
    input.dispose();
  });

  it('a quick swipe up is a frontflip (up) and swipe down a backflip (down)', () => {
    const { input, down, move, up } = touchInput();
    down({ id: 1, x: 200, y: 300, t: 0 });
    move({ id: 1, x: 202, y: 250, t: 100 });
    expect(actions(input)).toEqual(['up']);
    expect(input.steer()).toBe(0);
    up({ id: 1, x: 202, y: 250, t: 120 });
    down({ id: 2, x: 200, y: 200, t: 500 });
    move({ id: 2, x: 198, y: 250, t: 600 });
    expect(actions(input)).toEqual(['down']);
    input.dispose();
  });

  it('a quick sideways swipe is a trick steered that way, once per touch', () => {
    const { input, down, move, up } = touchInput();
    down({ id: 1, x: 100, y: 300, t: 0 });
    move({ id: 1, x: 140, y: 302, t: 90 });
    expect(actions(input)).toEqual(['trick']);
    expect(input.steer()).toBeGreaterThanOrEqual(0.5);
    move({ id: 1, x: 190, y: 302, t: 140 });
    expect(actions(input)).toEqual([]);
    up({ id: 1, x: 190, y: 302, t: 160 });
    down({ id: 2, x: 300, y: 300, t: 400 });
    move({ id: 2, x: 255, y: 300, t: 480 });
    expect(actions(input)).toEqual(['trick']);
    expect(input.steer()).toBeLessThanOrEqual(-0.5);
    input.dispose();
  });

  it('a slow drag only steers, with no trick or flip', () => {
    const { input, down, move } = touchInput();
    down({ id: 1, x: 100, y: 300, t: 0 });
    move({ id: 1, x: 160, y: 300, t: 900 });
    expect(actions(input)).toEqual([]);
    expect(input.steer()).toBe(1);
    input.dispose();
  });

  it('a swipe down in the air is the FRONTFLIP alone, with no spin from the touched side', () => {
    // A straight flick and a slanted thumb flick, both on the right half (holding it spins heelside).
    for (const dx of [4, -50]) {
      const { land, spun } = jumpWithTouch(flick(280, 400, dx, 60, 140, 100));
      expect(spun).toBe(0);
      expect(land?.spin).toBe(0);
      expect(land?.flips).toBe(1);
      expect(flipName(land?.flips ?? 0)).toBe('FRONTFLIP');
    }
    const { land } = jumpWithTouch(flick(120, 400, -6, -60, 140, 100));
    expect(land?.spin).toBe(0);
    expect(flipName(land?.flips ?? 0)).toBe('BACKFLIP');
  });

  it('holding a side in the air still spins that way', () => {
    const { land, spun } = jumpWithTouch([
      { id: 1, x: 300, y: 400, t: 100 },
      { id: 1, x: 301, y: 401, t: 400 },
    ]);
    expect(spun).toBeGreaterThan(0);
    expect(land?.flips).toBe(0);
  });

  it('a slanted flick down (45 degrees, like a thumb) is a flip, not a spin', () => {
    // Recorded from Mobile Safari in the iOS Simulator: 50 px down and 50 px left in 150 ms.
    const { input, down, move } = touchInput({ t: 0 });
    down({ id: 1, x: 280, y: 400, t: 0 });
    for (const [t, d] of [
      [22, 4],
      [40, 11],
      [59, 22],
      [79, 34],
      [100, 43],
    ] as const) {
      move({ id: 1, x: 280 - d, y: 400 + d, t });
    }
    expect(actions(input)).toEqual(['down']);
    expect(input.steer()).toBe(0);
    input.dispose();
  });

  it('a short or slow flick down still flips: 26 px, or 40 px over 250 ms', () => {
    const a = touchInput({ t: 0 });
    a.down({ id: 1, x: 200, y: 300, t: 0 });
    for (const p of flick(200, 300, 3, 26, 80)) a.move(p);
    expect(actions(a.input)).toEqual(['down']);
    a.input.dispose();
    const b = touchInput({ t: 0 });
    b.down({ id: 1, x: 200, y: 300, t: 0 });
    for (const p of flick(200, 300, -8, 40, 250)) b.move(p);
    expect(actions(b.input)).toEqual(['down']);
    b.input.dispose();
  });

  it('a flick down after resting the thumb still flips', () => {
    const clock = { t: 0 };
    const { input, down, move } = touchInput(clock);
    down({ id: 1, x: 300, y: 300, t: 0 });
    clock.t = 600;
    expect(input.steer()).toBe(1);
    for (const p of flick(300, 300, 2, 50, 120, 600)) move(p);
    expect(actions(input)).toEqual(['down']);
    expect(input.steer()).toBe(0);
    input.dispose();
  });

  it('a touch holds its side only once it is clearly not a flick', () => {
    const clock = { t: 0 };
    const { input, down, move, up } = touchInput(clock);
    down({ id: 1, x: 300, y: 300, t: 0 });
    clock.t = 40;
    expect(input.steer()).toBe(0);
    clock.t = 90;
    expect(input.steer()).toBe(1);
    up({ id: 1, x: 300, y: 300, t: 100 });
    // A slow vertical drag is no flick: it holds the side once the flick window has passed.
    clock.t = 1000;
    down({ id: 2, x: 100, y: 300, t: 1000 });
    move({ id: 2, x: 100, y: 312, t: 1050 });
    clock.t = 1200;
    move({ id: 2, x: 101, y: 318, t: 1200 });
    expect(input.steer()).toBe(0);
    clock.t = 1300;
    expect(actions(input)).toEqual([]);
    expect(input.steer()).toBe(-1);
    input.dispose();
  });

  it('a slanted sideways flick (30 degrees) is still a spin', () => {
    const { input, down, move } = touchInput({ t: 0 });
    down({ id: 1, x: 100, y: 300, t: 0 });
    for (const p of flick(100, 300, 60, 30, 120)) move(p);
    expect(actions(input)).toEqual(['trick']);
    expect(input.steer()).toBeGreaterThanOrEqual(0.5);
    input.dispose();
  });

  it('two fingers down is the brake, one finger is not', () => {
    const clock = { t: 0 };
    const { input, down, up } = touchInput(clock);
    down({ id: 1, x: 100, y: 300, t: 0 });
    expect(input.brake()).toBe(false);
    down({ id: 2, x: 300, y: 300, t: 10 });
    expect(input.brake()).toBe(true);
    expect(input.steer()).toBe(0);
    up({ id: 2, x: 300, y: 300, t: 200 });
    clock.t = 200;
    expect(input.brake()).toBe(false);
    expect(input.steer()).toBe(-1);
    input.dispose();
  });
});
