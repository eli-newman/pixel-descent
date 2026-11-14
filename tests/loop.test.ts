import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRAME, STEP } from '../src/core/config';
import { Loop } from '../src/platform/loop';
import { makeGame } from './helpers/fakes';

describe('Loop', () => {
  let queued: FrameRequestCallback | null = null;
  const cancel = vi.fn();

  /** Run the pending animation frame at `ms`. */
  const frame = (ms: number): void => {
    const cb = queued;
    queued = null;
    cb?.(ms);
  };

  beforeEach(() => {
    queued = null;
    cancel.mockClear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs whole fixed steps for the elapsed time and renders once per frame', () => {
    const update = vi.fn();
    const render = vi.fn();
    new Loop(update, render).start();
    frame(STEP * 3.5 * 1000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith(STEP);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('carries the leftover time into the next frame', () => {
    const update = vi.fn();
    new Loop(update, vi.fn()).start();
    frame(STEP * 0.6 * 1000);
    expect(update).toHaveBeenCalledTimes(0);
    frame(STEP * 1.2 * 1000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('caps the catch-up after a long stall', () => {
    const update = vi.fn();
    new Loop(update, vi.fn()).start();
    frame(60_000);
    expect(update.mock.calls.length).toBeLessThanOrEqual(Math.ceil(MAX_FRAME / STEP));
  });

  it('tells the render how far it is into the next step', () => {
    const render = vi.fn();
    new Loop(() => {}, render).start();
    frame(STEP * 3.25 * 1000);
    expect(render).toHaveBeenLastCalledWith(expect.closeTo(0.25, 6));
  });

  it('scrolls the slope by an even amount every frame on a 90 Hz screen, not 1, 1, then 2 steps', () => {
    // A 90 Hz display gets the 120 Hz steps 1, 1, 2 at a time. Drawn at the last whole step, the slope lurched every
    // third frame; drawn at the screen's moment, it moves the same distance each frame.
    const { game, input } = makeGame('smooth');
    input.push('start');
    const shown: number[] = [];
    new Loop(
      (dt) => game.update(dt),
      (alpha) => {
        game.setBlend(alpha);
        shown.push(game.camYi + game.camFrac);
      },
    ).start();
    for (let n = 1; n <= 300; n++) frame((n * 1000) / 90);
    expect(game.phase).toBe('playing');
    // Late in the run, when the speed has settled, compare each frame's move with its neighbours'.
    const moves = shown
      .slice(200)
      .map((y, i, a) => (i === 0 ? 0 : y - (a[i - 1] ?? y)))
      .slice(1);
    const jolts = moves.slice(1).map((m, i) => Math.abs(m - (moves[i] ?? m)));
    expect(Math.min(...moves)).toBeGreaterThan(0.5);
    expect(Math.max(...jolts)).toBeLessThan(0.1);
  });

  it('stops: a late frame does nothing and starting twice queues one frame', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new Loop(update, render);
    loop.start();
    const late = queued;
    loop.start();
    expect(queued).toBe(late);
    loop.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
    late?.(1000);
    expect(update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
