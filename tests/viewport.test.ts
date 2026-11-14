import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { fitCanvas, MAX_EXTRA_ROWS } from '../src/platform/viewport';
import { frameBox, sharpScale, slideRows, slopeBox } from '../src/platform/present';

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

describe('slopeBox, frameBox and slideRows', () => {
  const safe = { top: 59, right: 0, bottom: 34, left: 0 };

  it('covers the screen pixel for pixel, the frame on its box, the slope to both ends of a phone even fully slid', () => {
    const fit = fitCanvas(393, 852, 3, safe, 10, true);
    const rows = fit.above + H + fit.below + 1;
    const box = slopeBox(fit, 3, rows);
    expect(box.left).toBe(0);
    expect(box.pxW).toBe(393 * 3);
    // the backing is exactly the device pixels the canvas covers, so the browser never scales it
    expect(box.width * 3).toBeCloseTo(box.pxW, 6);
    expect(box.height * 3).toBeCloseTo(box.pxH, 6);
    // the canvas starts on a whole device pixel, above the screen's top
    expect(Number.isInteger(Math.round(box.top * 3 * 1e6) / 1e6)).toBe(true);
    expect(box.top).toBeLessThanOrEqual(0);
    // the frame's first row lands exactly on the frame's top edge
    expect(box.top * 3 + box.dy + fit.above * fit.scale).toBeCloseTo(fit.top * 3, 6);
    expect(box.dy).toBeGreaterThanOrEqual(0);
    expect(box.dy).toBeLessThan(1);
    // slid up by a whole logical pixel, the spare row still reaches the bottom
    const bottom = box.top * 3 + box.dy + rows * fit.scale - slideRows(1, fit.scale);
    expect(bottom).toBeGreaterThanOrEqual(852 * 3);
  });

  it('puts the HUD exactly on the frame', () => {
    const fit = fitCanvas(393, 852, 3, safe, 10, true);
    const box = frameBox(fit, 3);
    expect([box.left, box.top, box.dy]).toEqual([0, 0, 0]);
    expect(box.pxW).toBe(1179);
    expect(box.pxH).toBe(Math.round(H * fit.scale));
    expect(box.width).toBeCloseTo(fit.cssW, 6);
  });

  it('slides in whole device pixels, evenly, and never past one logical pixel', () => {
    expect([0, 0.2, 0.5, 0.99, 1].map((f) => slideRows(f, 7))).toEqual([0, 1, 4, 7, 7]);
    expect(slideRows(1.7, 4)).toBe(4);
    expect(slideRows(-0.3, 4)).toBe(0);
    // at a phone's 6.55 the slide steps one device pixel at a time and stops at 7
    const steps = Array.from({ length: 21 }, (_, i) => slideRows(i / 20, 6.55));
    expect(
      steps.every((v, i) => Number.isInteger(v) && (i === 0 || v - (steps[i - 1] ?? 0) <= 1)),
    ).toBe(true);
    expect(steps.at(-1)).toBe(7);
  });
});

describe('sharpScale', () => {
  it('blows a picture up by the next whole number, or exactly a whole scale', () => {
    expect(sharpScale(6.55)).toBe(7);
    expect(sharpScale(6)).toBe(6);
    expect(sharpScale(3.0000000001)).toBe(3);
    expect(sharpScale((393 * 3) / 180)).toBe(7);
    expect(sharpScale(0.5)).toBe(1);
  });
});
