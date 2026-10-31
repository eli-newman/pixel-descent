import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRAME, STEP } from '../src/core/config';
import { Loop } from '../src/platform/loop';

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
