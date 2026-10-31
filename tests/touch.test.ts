import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/input';

type Pt = { id: number; x: number; y: number; t: number };

function touchInput(): {
  input: Input;
  down: (p: Pt) => void;
  move: (p: Pt) => void;
  up: (p: Pt) => void;
} {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('Element', class {});
  const input = new Input({
    getBoundingClientRect: () => ({ left: 0, width: 400 }),
  } as unknown as HTMLCanvasElement);
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

describe('touch gestures', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('two fingers down is the brake, one finger is not', () => {
    const { input, down, up } = touchInput();
    down({ id: 1, x: 100, y: 300, t: 0 });
    expect(input.brake()).toBe(false);
    down({ id: 2, x: 300, y: 300, t: 10 });
    expect(input.brake()).toBe(true);
    up({ id: 2, x: 300, y: 300, t: 200 });
    expect(input.brake()).toBe(false);
    input.dispose();
  });
});
