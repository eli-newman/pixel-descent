import { describe, expect, it } from 'vitest';
import { START_Y, STEP } from '../src/core/config';
import { launch } from '../src/sim/rider';
import { cruiseSpeed, topSpeed } from '../src/sim/speed';
import { Sim, type SimInput } from '../src/sim/sim';
import { botInput, runBot } from './helpers/bot';

const none: SimInput = { steer: 0, trick: false };

function play(sim: Sim, steps: number, input: (i: number) => SimInput = () => none): void {
  for (let i = 0; i < steps && !sim.crashed; i++) sim.step(input(i));
}

describe('sim', () => {
  it('reproduces a run with spins in the air exactly from the same inputs', () => {
    // Hold a direction or press the trick button whenever airborne; otherwise follow the path.
    const inputs: SimInput[] = [];
    const live = new Sim('spin-repeat', { forceSpeed: true });
    live.begin();
    let jumps = 0;
    let wasAir = false;
    for (let i = 0; i < 60000 && !live.crashed && jumps < 3; i++) {
      const air = live.rider.air;
      if (air && !wasAir) jumps++;
      wasAir = air;
      const input: SimInput = air
        ? { steer: jumps % 2 === 0 ? 1 : -0.75, trick: jumps === 2 && live.rider.airT < 0.02 }
        : botInput(live);
      inputs.push(input);
      live.step(input);
    }
    expect(jumps).toBeGreaterThanOrEqual(2);
    expect(live.score.tricks).toBeGreaterThan(0);
    const copy = new Sim('spin-repeat', { forceSpeed: true });
    copy.begin();
    for (const input of inputs) copy.step(input);
    expect(copy.scoreValue).toBe(live.scoreValue);
    expect(copy.score.trickPoints).toBe(live.score.trickPoints);
    expect(copy.rider.x).toBe(live.rider.x);
    expect(copy.rider.spin).toBe(live.rider.spin);
    expect(copy.crashed).toBe(live.crashed);
  });

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
    const sim = new Sim('straight');
    sim.begin();
    // Hold a gentle line down the starting lane, which is clear for 300px.
    play(sim, 700);
    expect(sim.rider.speed).toBeGreaterThan(cruiseSpeed(sim.distM) + 20);
    expect(sim.mult).toBeGreaterThan(1.1);
  });

  it('crashes into trees and ends the run after the tumble', () => {
    const sim = new Sim('crash');
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
    const sim = new Sim('air', { forceSpeed: true });
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

  it('riding past the rock of a cliff is a slope, not a drop, while the rock itself launches you', () => {
    const run = (gapOffset: number): boolean => {
      const sim = new Sim('cliff-gap');
      sim.begin();
      play(sim, 5);
      const r = sim.rider;
      sim.ramps.push({
        id: 999,
        kind: 'cliff',
        x: 90,
        y: r.y + 30,
        half: 90,
        landEnd: r.y + 900,
        used: false,
        seed: 1,
        segs: [{ x0: r.x + gapOffset - 20, x1: r.x + gapOffset + 20, dy: 0 }],
      });
      let launched = false;
      for (let i = 0; i < 120; i++) {
        sim.step({ steer: 0, trick: false });
        if (sim.events.some((e) => e.type === 'launch')) launched = true;
      }
      return launched;
    };
    expect(run(0)).toBe(true);
    expect(run(80)).toBe(false);
  });

  it('a cliff drop hangs longer than a kicker and pays a drop bonus on a clean landing', () => {
    const hop = new Sim('cliff-a');
    hop.begin();
    play(hop, 5);
    hop.rider.speed = 200;
    launch(hop.rider);
    const sim = new Sim('cliff-b');
    sim.begin();
    play(sim, 5);
    sim.rider.speed = 200;
    launch(sim.rider, true);
    expect(sim.rider.airDur).toBeGreaterThan(hop.rider.airDur * 1.8);
    expect(sim.rider.airH).toBeGreaterThan(hop.rider.airH * 1.9);
    sim.cliffJump = true;
    sim.rider.airT = sim.rider.airDur - STEP * 2;
    sim.rider.hx = 0;
    sim.rider.hv = 0;
    let pts = 0;
    for (let i = 0; i < 5; i++) {
      sim.step({ steer: 0, trick: false });
      for (const e of sim.events) if (e.type === 'land' && e.quality === 'clean') pts = e.pts;
    }
    expect(pts).toBeGreaterThanOrEqual(75);
    expect(sim.cliffJump).toBe(false);
  });

  it('braking swings the board sideways and plows down to a crawl, then lets go', () => {
    const sim = new Sim('brake');
    sim.begin();
    for (let i = 0; i < 400 && !sim.crashed; i++) sim.step(botInput(sim));
    const fast = sim.rider.speed;
    for (let i = 0; i < 360 && !sim.crashed; i++) sim.step({ ...botInput(sim), brake: true });
    expect(sim.crashed).toBe(false);
    expect(sim.rider.brake).toBeGreaterThan(0.95);
    expect(Math.abs(sim.rider.hx)).toBeGreaterThan(0.8);
    expect(sim.rider.speed).toBeLessThan(fast * 0.6);
    for (let i = 0; i < 240 && !sim.crashed; i++) sim.step(botInput(sim));
    expect(sim.rider.brake).toBe(0);
  });

  it('bails when landing mid-trick or sideways', () => {
    const sim = new Sim('bail');
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
    const sim = new Sim('sloppy');
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
    const a = new Sim('quant');
    const b = new Sim('quant');
    a.begin();
    b.begin();
    play(a, 600, () => ({ steer: 0.3, trick: false }));
    play(b, 600, () => ({ steer: 0.3 + 0.0001, trick: false }));
    expect(a.rider.x).toBe(b.rider.x);
  });
});

describe('top speed at distance', () => {
  it('lets a tucked rider outrun the base ramp', () => {
    const sim = new Sim('speed', { forceSpeed: true });
    runBot(sim, 1500);
    expect(sim.topSpeedSeen).toBeGreaterThan(topSpeed(0));
    expect(sim.topSpeedSeen).toBeGreaterThan(280);
  });

  describe('spins', () => {
    /** A sim with the rider in the air, a few steps before touchdown, having turned `spin` degrees. */
    function nearLanding(spin: number, dir: 1 | -1 = 1): Sim {
      const sim = new Sim('spin-land');
      sim.begin();
      play(sim, 5);
      const r = sim.rider;
      launch(r);
      r.speed = 150;
      r.hx = 0;
      r.hv = 0;
      r.spin = spin;
      r.spinDir = dir;
      r.spinGoal = Math.ceil(spin / 180) * 180;
      r.airT = r.airDur - STEP * 2;
      return sim;
    }
    function finish(sim: Sim): { quality: string; pts: number; spin: number; switch: boolean } {
      let out = { quality: '', pts: 0, spin: 0, switch: false };
      for (let i = 0; i < 5; i++) {
        sim.step(none);
        for (const e of sim.events) {
          if (e.type === 'land')
            out = { quality: e.quality, pts: e.pts, spin: e.spin, switch: e.switch };
        }
      }
      return out;
    }

    it('lands a 180 backwards: fine, scored, a little slower than a full turn', () => {
      const half = nearLanding(180);
      const before = half.rider.speed;
      const h = finish(half);
      expect(half.crashed).toBe(false);
      expect(h).toMatchObject({ quality: 'clean', spin: 180, switch: true });
      expect(h.pts).toBeGreaterThan(0);
      expect(half.score.tricks).toBe(1);
      const gainHalf = half.rider.speed - before;

      const full = nearLanding(360);
      const beforeFull = full.rider.speed;
      const f = finish(full);
      expect(f).toMatchObject({ quality: 'clean', spin: 360, switch: false });
      expect(f.pts).toBeGreaterThan(h.pts);
      expect(full.rider.speed - beforeFull).toBeGreaterThan(gainHalf);
      expect(full.score.trickPoints).toBe(f.pts);
    });

    it('a landing a little off a half turn is sloppy, far off is a bail', () => {
      const sloppy = nearLanding(180 + 50);
      const s = finish(sloppy);
      expect(s.quality).toBe('sloppy');
      expect(s.pts).toBe(0);
      expect(sloppy.crashed).toBe(false);
      expect(sloppy.rider.speed).toBeLessThan(150);
      expect(sloppy.score.trickPoints).toBe(0);

      const bail = nearLanding(180 + 80);
      finish(bail);
      expect(bail.crashed).toBe(true);
      expect(bail.crashCause).toBe('bail');
    });

    it('a trick press mid air spins and pays on landing, using only the air that is left', () => {
      const sim = new Sim('spin-trick');
      sim.begin();
      play(sim, 5);
      sim.rider.speed = 200;
      launch(sim.rider, true);
      const spins: number[] = [];
      let landed: { pts: number; spin: number } | null = null;
      for (let i = 0; i < 4000 && !landed; i++) {
        sim.step({ steer: 0, trick: i === 3 || i === 70 });
        for (const e of sim.events) {
          if (e.type === 'spin') spins.push(e.deg);
          if (e.type === 'land') landed = { pts: e.pts, spin: e.spin };
        }
      }
      expect(spins).toEqual([360, 720]);
      expect(landed).toMatchObject({ spin: 720 });
      expect(sim.crashed).toBe(false);
    });
  });
});
