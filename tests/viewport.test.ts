import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { fitCanvas, MAX_EXTRA_ROWS, slideTransform } from '../src/platform/viewport';

describe('fitCanvas', () => {
  it('uses the largest whole scale that fits and centres the picture', () => {
    const fit = fitCanvas(1000, 1000, 1);
    expect(fit.scale).toBe(3);
    expect(fit.cssW).toBe(W * 3);
    expect(fit.cssH).toBe(H * 3);
    expect(fit.left).toBe((1000 - W * 3) / 2);
    expect(fit.top).toBe((1000 - H * 3) / 2);
  });

  it('scales in device pixels, so retina screens keep crisp squares', () => {
    const fit = fitCanvas(390, 844, 3);
    expect(fit.scale).toBe(6);
    expect(fit.cssW).toBe((W * 6) / 3);
    expect(fit.cssH).toBe((H * 6) / 3);
  });

  it('never goes below scale 1 on a tiny window', () => {
    const fit = fitCanvas(50, 50, 1);
    expect(fit.scale).toBe(1);
    expect(fit.left).toBe(0);
    expect(fit.top).toBe(0);
  });

  it('stays inside the safe area and the margin', () => {
    const safe = { top: 47, right: 0, bottom: 34, left: 0 };
    const fit = fitCanvas(390, 844, 3, safe, 10);
    expect(fit.scale).toBeLessThanOrEqual(6);
    expect(fit.top).toBeGreaterThanOrEqual(47);
    expect(fit.top + fit.cssH).toBeLessThanOrEqual(844 - 34);
    expect(fit.cssH + 20).toBeLessThanOrEqual(844 - 47 - 34);
  });
});

describe('fitCanvas on a phone (fill)', () => {
  const safe = { top: 59, right: 0, bottom: 34, left: 0 };

  it('fills the whole width, starts just under the notch, and the slope reaches both ends of the screen', () => {
    const fit = fitCanvas(393, 852, 3, safe, 10, true);
    expect(fit.left).toBe(0);
    expect(fit.cssW).toBeCloseTo(393, 9);
    expect(fit.scale).toBeCloseTo((393 * 3) / W, 9);
    expect(fit.top).toBe(59);
    // the frame fits above the home bar, so nothing in the HUD is ever under it
    expect(fit.top + fit.cssH).toBeLessThanOrEqual(852 - 34);
    // whole rows of slope cover the screen above and below the frame
    expect((fit.above * fit.scale) / 3).toBeGreaterThanOrEqual(fit.top);
    expect((fit.below * fit.scale) / 3).toBeGreaterThanOrEqual(852 - fit.top - fit.cssH);
    expect(((fit.above - 1) * fit.scale) / 3).toBeLessThan(fit.top);
  });

  it('keeps whole, crisp pixels where filling the width would push the frame past the screen', () => {
    // A tablet held upright is wider than the frame's shape: fit by height, as on desktop.
    const fit = fitCanvas(820, 1180, 2, safe, 10, true);
    expect(Number.isInteger(fit.scale)).toBe(true);
    expect(fit.left).toBeGreaterThan(0);
  });

  it('never draws more than MAX_EXTRA_ROWS of slope past the frame', () => {
    const fit = fitCanvas(100, 5000, 1, undefined, 0, true);
    expect(fit.below).toBe(MAX_EXTRA_ROWS);
  });

  it('extends the slope over the leftover rows on desktop too', () => {
    const fit = fitCanvas(1000, 1000, 1);
    expect(fit.above).toBe(Math.ceil((1000 - H * 3) / 2 / 3));
    expect(fit.below).toBe(fit.above);
  });
});

describe('slideTransform', () => {
  it('slides the slope up by the camera fraction, in whole device pixels', () => {
    expect(slideTransform(0, 6, 3)).toBe('');
    expect(slideTransform(0.5, 6, 3)).toBe('translateY(-1px)');
    expect(slideTransform(1 / 6, 6, 3)).toBe(`translateY(${-1 / 3}px)`);
    expect(slideTransform(0.04, 6, 3)).toBe('');
  });

  it('never slides past one logical pixel, so the spare row is all that ever shows', () => {
    expect(slideTransform(1.7, 4, 2)).toBe('translateY(-2px)');
    expect(slideTransform(-0.3, 4, 2)).toBe('');
  });
});
