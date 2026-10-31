import { describe, expect, it } from 'vitest';
import { PX_PER_M, START_Y } from '../src/core/config';
import {
  COMBO_WINDOW,
  MAX_COMBO,
  POINTS,
  addDistance,
  addSpin,
  spinPoints,
  breakCombo,
  comboLeft,
  addNearMiss,
  addStar,
  createScore,
  distanceMeters,
  totalScore,
} from '../src/sim/score';

describe('score', () => {
  it('measures distance from the start line', () => {
    expect(distanceMeters(START_Y)).toBe(0);
    expect(distanceMeters(START_Y - 50)).toBe(0);
    expect(distanceMeters(START_Y + 800)).toBe(100);
  });

  it('adds up distance, stars and near misses', () => {
    const s = createScore();
    addStar(s);
    addStar(s);
    addNearMiss(s, 10);
    addDistance(s, 300 * PX_PER_M, 1);
    expect(totalScore(s)).toBe(300 + 2 * POINTS.star + POINTS.nearMiss);
  });

  it('builds a near miss combo inside the window and resets outside it', () => {
    const s = createScore();
    expect(addNearMiss(s, 5)).toBe(POINTS.nearMiss);
    expect(addNearMiss(s, 5 + COMBO_WINDOW - 0.1)).toBe(POINTS.nearMiss * 2);
    expect(addNearMiss(s, 5 + COMBO_WINDOW * 3)).toBe(POINTS.nearMiss);
    expect(s.nearMisses).toBe(3);
  });

  it('caps the combo', () => {
    const s = createScore();
    for (let i = 0; i < 12; i++) addNearMiss(s, i);
    expect(s.combo).toBe(MAX_COMBO);
  });

  it('pays more per metre, per near miss and per trick at a higher speed multiplier', () => {
    const slow = createScore();
    const fast = createScore();
    addDistance(slow, 100 * PX_PER_M, 1);
    addDistance(fast, 100 * PX_PER_M, 2.5);
    expect(Math.floor(fast.distPoints)).toBe(250);
    expect(totalScore(fast)).toBeGreaterThan(totalScore(slow));
    expect(addNearMiss(createScore(), 1, 2)).toBe(POINTS.nearMiss * 2);
    expect(addSpin(createScore(), 360, 2)).toBe(spinPoints(360) * 2);
  });

  it('values risk lane stars at three times a normal star', () => {
    const s = createScore();
    expect(addStar(s, true)).toBe(POINTS.star * 3);
    expect(s.laneStars).toBe(1);
    expect(s.stars).toBe(1);
  });

  it('drains the combo meter and lets a bad landing break the combo', () => {
    const s = createScore();
    expect(comboLeft(s, 0)).toBe(0);
    addNearMiss(s, 10);
    expect(comboLeft(s, 10)).toBe(1);
    expect(comboLeft(s, 10 + COMBO_WINDOW / 2)).toBeCloseTo(0.5);
    expect(comboLeft(s, 10 + COMBO_WINDOW + 1)).toBe(0);
    breakCombo(s);
    expect(s.combo).toBe(0);
  });

  it('scores spins by degrees, and a bigger spin pays more per half turn', () => {
    expect([180, 360, 540, 720].map(spinPoints)).toEqual([30, 70, 120, 180]);
    expect(spinPoints(0)).toBe(0);
    const s = createScore();
    expect(addSpin(s, 180, 1)).toBe(POINTS.spin);
    expect(addSpin(s, 360, 2.5)).toBe(175);
    expect(s.tricks).toBe(2);
    expect(s.trickPoints).toBe(30 + 175);
    expect(totalScore(s)).toBe(205);
  });
});
