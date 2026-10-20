import { describe, expect, it } from 'vitest';
import { MAX_SPEED, STEP } from '../src/config';
import {
  BAIL_HX,
  TRICK_TIME,
  airTime,
  createRider,
  cruiseSpeed,
  launch,
  maxFlightPx,
  riderZ,
  speedMultiplier,
  startTrick,
  stepRider,
  topSpeed,
  tuckFraction,
  type RiderState,
  type Surface,
} from '../src/rider';

const flat: Surface = { ice: false, drift: false };

function run(
  r: RiderState,
  steer: number,
  seconds: number,
  dist = 800,
  surface: Surface = flat,
): void {
  const env = { cruise: cruiseSpeed(dist), top: topSpeed(dist), surface };
  for (let i = 0; i < seconds / STEP; i++) stepRider(r, steer, STEP, env);
}

describe('speed model', () => {
  it('has a top speed above cruising speed at every distance, and never above the cap', () => {
    for (const d of [0, 100, 500, 1000, 2000, 5000, 20000]) {
      expect(topSpeed(d)).toBeGreaterThan(cruiseSpeed(d) + 50);
      expect(topSpeed(d)).toBeLessThanOrEqual(MAX_SPEED);
    }
    expect(topSpeed(5000)).toBeGreaterThan(235);
  });

  it('keeps the old cruising ramp as the base', () => {
    expect(cruiseSpeed(0)).toBeCloseTo(85);
    expect(cruiseSpeed(1000)).toBeCloseTo(85 + 150 * (1 - Math.exp(-1)));
    expect(cruiseSpeed(1e6)).toBeLessThan(236);
  });

  it('accelerates well past cruising speed when going straight downhill', () => {
    const r = createRider();
    r.speed = cruiseSpeed(800);
    const start = r.speed;
    run(r, 0, 1);
    expect(r.speed).toBeGreaterThan(start + 30);
    run(r, 0, 8);
    expect(r.speed).toBeGreaterThan(cruiseSpeed(800) + 0.9 * (topSpeed(800) - cruiseSpeed(800)));
    expect(r.speed).toBeLessThanOrEqual(topSpeed(800) + 1e-6);
  });

  it('scrubs speed while carving across the slope, harder the more sideways', () => {
    const results: number[] = [];
    for (const steer of [0.3, 0.6, 1]) {
      const r = createRider();
      r.speed = topSpeed(800);
      // weave back and forth so the rider never reaches the wall
      for (let i = 0; i < 3 / STEP; i++) {
        const sign = Math.floor(i / 40) % 2 === 0 ? 1 : -1;
        stepRider(r, steer * sign, STEP, {
          cruise: cruiseSpeed(800),
          top: topSpeed(800),
          surface: flat,
        });
        r.x = 90;
      }
      results.push(r.speed);
    }
    const [mild, mid, hard] = results as [number, number, number];
    expect(mild).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(hard);
    expect(hard).toBeLessThan(cruiseSpeed(800));
    expect(hard).toBeGreaterThan(cruiseSpeed(800) * 0.8);
  });

  it('trades control for speed: a straight rider covers more ground than a carving one', () => {
    const straight = createRider();
    straight.speed = cruiseSpeed(800);
    const carver = createRider();
    carver.speed = cruiseSpeed(800);
    run(straight, 0, 6);
    for (let i = 0; i < 6 / STEP; i++) {
      const steer = Math.floor(i / 120) % 2 === 0 ? 1 : -1;
      stepRider(carver, steer, STEP, {
        cruise: cruiseSpeed(800),
        top: topSpeed(800),
        surface: flat,
      });
    }
    expect(straight.y).toBeGreaterThan(carver.y + 100);
  });

  it('recovers to cruising speed after being slowed, and bleeds nothing at cruising speed when straight', () => {
    const r = createRider();
    r.speed = 30;
    run(r, 0, 3);
    expect(r.speed).toBeGreaterThan(cruiseSpeed(800));
  });

  it('turns a snowdrift into a crawl and keeps ice slippery', () => {
    const drift = createRider();
    drift.speed = topSpeed(800);
    run(drift, 0, 3, 800, { ice: false, drift: true });
    expect(drift.speed).toBeLessThan(cruiseSpeed(800) * 0.6);

    const normal = createRider();
    const ice = createRider();
    run(normal, 1, 0.25);
    run(ice, 1, 0.25, 800, { ice: true, drift: false });
    // the icy board is slower to come round to the new heading
    expect(Math.abs(ice.hx)).toBeLessThan(Math.abs(normal.hx));
  });

  it('maps the tuck to a score multiplier from x1 to x2.5', () => {
    expect(tuckFraction(cruiseSpeed(500), 500)).toBe(0);
    expect(tuckFraction(topSpeed(500), 500)).toBe(1);
    expect(speedMultiplier(0)).toBe(1);
    expect(speedMultiplier(1)).toBe(2.5);
    expect(speedMultiplier(5)).toBe(2.5);
  });
});

describe('air and tricks', () => {
  it('flies for a parabola and lands after airTime', () => {
    const r = createRider();
    r.speed = 200;
    launch(r);
    expect(r.air).toBe(true);
    expect(r.airDur).toBeCloseTo(airTime(200));
    let peak = 0;
    let steps = 0;
    while (!r.landed && steps < 1000) {
      stepRider(r, 0, STEP, { cruise: 150, top: 300, surface: flat });
      peak = Math.max(peak, riderZ(r));
      steps++;
    }
    expect(r.landed).toBe(true);
    expect(steps * STEP).toBeGreaterThanOrEqual(r.airDur - STEP);
    expect(peak).toBeCloseTo(r.airH, 0);
    expect(maxFlightPx(300)).toBeGreaterThan(maxFlightPx(100));
  });

  it('does not change speed in the air', () => {
    const r = createRider();
    r.speed = 250;
    launch(r);
    for (let i = 0; i < 30; i++) stepRider(r, 1, STEP, { cruise: 150, top: 300, surface: flat });
    expect(r.speed).toBe(250);
  });

  it('only starts a trick in the air with time to finish it, and counts it when done', () => {
    const r = createRider();
    r.speed = 250;
    expect(startTrick(r)).toBe(false);
    launch(r);
    expect(startTrick(r)).toBe(true);
    expect(startTrick(r)).toBe(false);
    let done = false;
    for (let i = 0; i < (TRICK_TIME + 0.1) / STEP; i++) {
      stepRider(r, 0, STEP, { cruise: 150, top: 300, surface: flat });
      if (r.trickDone) done = true;
    }
    expect(done).toBe(true);
    expect(r.tricks).toBe(1);
    expect(r.trickT).toBe(0);
  });

  it('refuses a trick too late in the jump', () => {
    const r = createRider();
    r.speed = 100;
    launch(r);
    r.airT = r.airDur - TRICK_TIME / 2;
    expect(startTrick(r)).toBe(false);
  });

  it('has sensible thresholds', () => {
    expect(BAIL_HX).toBeGreaterThan(0.5);
  });
});
