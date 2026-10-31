import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { fitCanvas } from '../src/platform/viewport';

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
