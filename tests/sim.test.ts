import { describe, expect, it } from 'vitest';
import { START_Y, STEP } from '../src/config';
import {
  AV_START_GAP,
  avalancheDanger,
  avalancheRatio,
  createAvalanche,
  stepAvalanche,
} from '../src/avalanche';
import { cruiseSpeed, launch, topSpeed } from '../src/rider';
import { Sim, type SimInput } from '../src/sim';
import { botInput, runBot } from './helpers/bot';

const none: SimInput = { steer: 0, trick: false };

function play(sim: Sim, steps: number, input: (i: number) => SimInput = () => none): void {
  for (let i = 0; i < steps && !sim.crashed; i++) sim.step(input(i));
}

describe('sim', () => {
  it('starts still and moves once begun', () => {
    const sim = new Sim('start');
    play(sim, 60);
    expect(sim.rider.y).toBe(START_Y);
    sim.begin();
    play(sim, 120);
    expect(sim.rider.y).toBeGreaterThan(START_Y + 10);
  });

  it('is deterministic: the same seed and the same inputs give the same run', () => {
    const script = (i: number): SimInput => ({
      steer: Math.sin(i / 90) * 0.9,
      trick: i % 530 === 0,
    });
    const a = new Sim('repeat');
    const b = new Sim('repeat');
    a.begin();
    b.begin();
    play(a, 12000, script);
    play(b, 12000, script);
    expect(a.scoreValue).toBe(b.scoreValue);
    expect(a.rider).toEqual(b.rider);
    expect(a.score).toEqual(b.score);
    expect(a.steps).toBe(b.steps);
    expect(a.crashed).toBe(b.crashed);
  });

  it('gives different runs for different seeds', () => {
    const a = new Sim('one');
    const b = new Sim('two');
    a.begin();
    b.begin();
    play(a, 3000, () => ({ steer: 0.2, trick: false }));
    play(b, 3000, () => ({ steer: 0.2, trick: false }));
    expect(a.obstacles.map((o) => o.x)).not.toEqual(b.obstacles.map((o) => o.x));
  });

  it('gains speed going straight and scores more per metre for it', () => {
    const sim = new Sim('straight', { noAvalanche: true });
    sim.begin();
    // Hold a gentle line down the starting lane, which is clear for 300px.
    play(sim, 700);
    expect(sim.rider.speed).toBeGreaterThan(cruiseSpeed(sim.distM) + 20);
    expect(sim.mult).toBeGreaterThan(1.1);
  });

  it('crashes into trees and ends the run after the tumble', () => {
    const sim = new Sim('crash', { noAvalanche: true });
    sim.begin();
    play(sim, 200000, () => none);
    expect(sim.crashed).toBe(true);
    expect(sim.crashCause).toBe('obstacle');
    expect(sim.killer).not.toBeNull();
    expect(sim.finished).toBe(false);
    for (let i = 0; i < 200; i++) sim.step(none);
    expect(sim.finished).toBe(true);
  });

  it('lands a clean jump, pays for tricks and does not collide in the air', () => {
    const sim = new Sim('air', { noAvalanche: true, forceSpeed: true });
    sim.begin();
    let tricked = false;
    let landed = 0;
    for (let i = 0; i < 400000 && !sim.crashed && landed === 0; i++) {
      const input = botInput(sim);
      if (sim.rider.air && !tricked && sim.rider.airT > 0.05) {
        input.trick = true;
        tricked = true;
      }
      sim.step(input);
      for (const e of sim.events) if (e.type === 'land') landed++;
    }
    expect(sim.crashed).toBe(false);
    expect(landed).toBe(1);
    expect(sim.score.tricks).toBeGreaterThanOrEqual(1);
    expect(sim.score.trickPoints).toBeGreaterThan(0);
    expect(sim.score.landings).toBe(1);
  });

  it('bails when landing mid-trick or sideways', () => {
    const sim = new Sim('bail', { noAvalanche: true });
    sim.begin();
    play(sim, 5);
    launch(sim.rider);
    sim.rider.speed = 150;
    sim.rider.airT = sim.rider.airDur - STEP * 2;
    sim.rider.hx = 0.85;
    sim.rider.hv = 0;
    for (let i = 0; i < 5 && !sim.crashed; i++) sim.step({ steer: 1, trick: false });
    expect(sim.crashed).toBe(true);
    expect(sim.crashCause).toBe('bail');
  });

  it('scrubs speed on a sloppy landing', () => {
    const sim = new Sim('sloppy', { noAvalanche: true });
    sim.begin();
    play(sim, 5);
    launch(sim.rider);
    sim.rider.speed = 200;
    sim.rider.airT = sim.rider.airDur - STEP * 2;
    sim.rider.hx = 0.5;
    sim.rider.hv = 0;
    let quality = '';
    for (let i = 0; i < 5; i++) {
      sim.step({ steer: 0.6, trick: false });
      for (const e of sim.events) if (e.type === 'land') quality = e.quality;
    }
    expect(quality).toBe('sloppy');
    expect(sim.rider.speed).toBeLessThan(150);
    expect(sim.crashed).toBe(false);
  });

  it('quantises steering so tiny differences do not change a run', () => {
    const a = new Sim('quant', { noAvalanche: true });
    const b = new Sim('quant', { noAvalanche: true });
    a.begin();
    b.begin();
    play(a, 600, () => ({ steer: 0.3, trick: false }));
    play(b, 600, () => ({ steer: 0.3 + 0.0001, trick: false }));
    expect(a.rider.x).toBe(b.rider.x);
  });
});

describe('avalanche', () => {
  it('starts off screen and slower than a cruising rider', () => {
    const av = createAvalanche(START_Y);
    expect(START_Y - av.y).toBe(AV_START_GAP);
    expect(avalancheRatio(0)).toBeLessThan(0.7);
    expect(avalancheRatio(5000)).toBeGreaterThan(1);
  });

  it('speeds up when the rider is slow', () => {
    const fast = createAvalanche(1000);
    const slow = createAvalanche(1000);
    stepAvalanche(fast, 1000, cruiseSpeed(500), 500, STEP);
    stepAvalanche(slow, 1000, 30, 500, STEP);
    expect(slow.speed).toBeGreaterThan(fast.speed);
  });

  it('catches up if it has fallen far behind', () => {
    const near = createAvalanche(1000);
    const far = createAvalanche(1000);
    far.y = 1000 - 900;
    stepAvalanche(near, 1000, 200, 500, STEP);
    stepAvalanche(far, 1000, 200, 500, STEP);
    expect(far.speed).toBeGreaterThan(near.speed);
  });

  it('reports danger from 0 (far) to 1 (about to bury)', () => {
    const av = createAvalanche(1000);
    expect(avalancheDanger(av, 1000)).toBe(0);
    av.y = 1000 - 30;
    expect(avalancheDanger(av, 1000)).toBe(1);
  });

  it('buries a rider who stalls, and never catches a bot that tucks at top speed', () => {
    const slow = new Sim('slow', { touch: false });
    slow.begin();
    let steps = 0;
    // hug the wall: steer hard into the edge so the rider scrubs speed
    while (!slow.crashed && steps++ < 200000) slow.step({ steer: 1, trick: false });
    expect(slow.crashed).toBe(true);

    const fast = new Sim('fast', { forceSpeed: true });
    runBot(fast, 3000);
    expect(fast.crashed).toBe(false);
    expect(fast.avalanche.minGap).toBeGreaterThan(100);
  });

  it('eases off for touch riders', () => {
    const t = new Sim('ease', { touch: true });
    const k = new Sim('ease', { touch: false });
    t.begin();
    k.begin();
    play(t, 600);
    play(k, 600);
    expect(t.avalanche.y).toBeLessThan(k.avalanche.y);
  });
});

describe('top speed at distance', () => {
  it('lets a tucked rider outrun the base ramp', () => {
    const sim = new Sim('speed', { forceSpeed: true, noAvalanche: true });
    runBot(sim, 1500);
    expect(sim.topSpeedSeen).toBeGreaterThan(topSpeed(0));
    expect(sim.topSpeedSeen).toBeGreaterThan(280);
  });
});
