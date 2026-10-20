import { describe, expect, it } from 'vitest';
import { START_Y } from '../src/config';
import {
  COMBO_WINDOW,
  MAX_COMBO,
  POINTS,
  addGate,
  addNearMiss,
  addStar,
  createScore,
  distanceMeters,
  totalScore,
} from '../src/score';

describe('score', () => {
  it('measures distance from the start line', () => {
    expect(distanceMeters(START_Y)).toBe(0);
    expect(distanceMeters(START_Y - 50)).toBe(0);
    expect(distanceMeters(START_Y + 800)).toBe(100);
  });

  it('adds up distance, stars, gates and near misses', () => {
    const s = createScore();
    addStar(s);
    addStar(s);
    addGate(s);
    addNearMiss(s, 10);
    expect(totalScore(300, s)).toBe(300 + 2 * POINTS.star + POINTS.gate + POINTS.nearMiss);
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
});
