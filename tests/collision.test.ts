import { describe, expect, it } from 'vitest';
import {
  NEAR_MISS_PX,
  clearance,
  crossedY,
  obstacleBox,
  riderCenter,
  testObstacle,
} from '../src/collision';
import type { Obstacle, ObstacleKind } from '../src/world/types';

function obstacle(kind: ObstacleKind, size: number, half: number, x = 100, y = 200): Obstacle {
  return { id: 1, kind, size, variant: 0, x, y, half, judged: false, touched: false };
}

describe('collision', () => {
  it('crashes into a tree trunk', () => {
    const tree = obstacle('tree', 22, 9);
    // Rider anchor 8px above its contact point; put the contact point on the trunk base.
    expect(testObstacle({ x: 100, y: 200 - 8 }, tree)).toBe('crash');
  });

  it('passes a tree that is clearly to the side', () => {
    const tree = obstacle('tree', 22, 9);
    expect(testObstacle({ x: 130, y: 200 - 8 }, tree)).toBe('none');
  });

  it('passes above or below a tree without touching it', () => {
    const tree = obstacle('tree', 22, 9);
    expect(testObstacle({ x: 100, y: 150 }, tree)).toBe('none');
    expect(testObstacle({ x: 100, y: 230 }, tree)).toBe('none');
  });

  it('crashes into rocks and dead trees', () => {
    expect(testObstacle({ x: 100, y: 192 }, obstacle('rock', 14, 9))).toBe('crash');
    expect(testObstacle({ x: 100, y: 192 }, obstacle('dead', 18, 6))).toBe('crash');
  });

  it('slows (does not crash) on a bush', () => {
    expect(testObstacle({ x: 100, y: 192 }, obstacle('bush', 1, 9))).toBe('slow');
  });

  it('ignores pebbles', () => {
    const pebble = obstacle('rock', 6, 5);
    expect(obstacleBox(pebble)).toBeNull();
    expect(testObstacle({ x: 100, y: 192 }, pebble)).toBe('none');
  });

  it('measures clearance for near misses', () => {
    const rock = obstacle('rock', 14, 9);
    const box = obstacleBox(rock);
    expect(box).not.toBeNull();
    const edge = (box?.x1 ?? 0) + 3 + 2; // 2px of clearance beyond the rider radius
    const c = clearance({ x: edge, y: 192 }, rock);
    expect(c).not.toBeNull();
    expect(c ?? 99).toBeLessThanOrEqual(NEAR_MISS_PX);
    expect(clearance({ x: 100, y: 192 }, obstacle('bush', 1, 9))).toBeNull();
  });

  it('detects the moment the rider crosses a line', () => {
    expect(crossedY(199, 200.5, 200)).toBe(true);
    expect(crossedY(200.5, 201, 200)).toBe(false);
    expect(crossedY(190, 195, 200)).toBe(false);
  });

  it('places the contact point below the anchor', () => {
    expect(riderCenter({ x: 5, y: 10 }).y).toBeGreaterThan(10);
  });
});
