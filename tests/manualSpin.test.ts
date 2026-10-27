import { describe, expect, it } from 'vitest';
import { STEP } from '../src/config';
import { ReplayPlayer, ReplayRecorder, isReplay } from '../src/replay';
import { launch, MANUAL_RATE, spinAngle } from '../src/rider';
import { Store, DEFAULT_SETTINGS } from '../src/storage';
import { Sim, type SimInput } from '../src/sim';
import { memoryStorage } from './helpers/fakes';

const none: SimInput = { steer: 0, trick: false };

/** A sim with the rider launched off a long cliff drop (a lot of air), in the given spin mode. */
function jumper(manual: boolean): Sim {
  const sim = new Sim('manual-spin', { noAvalanche: true, manualSpin: manual });
  sim.begin();
  for (let i = 0; i < 5; i++) sim.step(none);
  const r = sim.rider;
  r.speed = 150;
  r.hx = 0;
  r.hv = 0;
  launch(r, true);
  return sim;
}

interface Landing {
  quality: string;
  pts: number;
  spin: number;
  switch: boolean;
}

/**
 * Hold `dir` until the rider has turned past `release` degrees, then let go and wait for touchdown.
 * Optionally turn back the other way until the angle falls under `back`.
 */
function flight(sim: Sim, release: number, dir: 1 | -1 = 1, back?: number): Landing | null {
  let landing: Landing | null = null;
  let phase = 0;
  for (let i = 0; i < 2000 && !landing && !sim.crashed; i++) {
    const r = sim.rider;
    let steer = 0;
    if (phase === 0) {
      if (r.spin < release) steer = dir;
      else phase = back === undefined ? 2 : 1;
    }
    if (phase === 1) {
      if (Math.abs(spinAngle(r)) > back!) steer = -dir;
      else phase = 2;
    }
    sim.step({ steer, trick: false });
    for (const e of sim.events) {
      if (e.type === 'land')
        landing = { quality: e.quality, pts: e.pts, spin: e.spin, switch: e.switch };
    }
  }
  return landing;
}

describe('manual spin', () => {
  it('turns at the set rate while a key is held, either way', () => {
    for (const dir of [1, -1] as const) {
      const sim = jumper(true);
      const r = sim.rider;
      for (let i = 0; i < 0.5 / STEP; i++) sim.step({ steer: dir, trick: false });
      // 0.5 s at 600 deg/s, minus a short ease in.
      expect(Math.abs(spinAngle(r))).toBeGreaterThan(MANUAL_RATE * 0.5 - 20);
      expect(Math.abs(spinAngle(r))).toBeLessThan(MANUAL_RATE * 0.5);
      expect(Math.sign(spinAngle(r))).toBe(dir);
    }
  });

  it('holds its angle after the key is released, with no auto finishing', () => {
    const sim = jumper(true);
    const r = sim.rider;
    for (let i = 0; i < 0.2 / STEP; i++) sim.step({ steer: 1, trick: false });
    for (let i = 0; i < 0.1 / STEP; i++) sim.step(none);
    const held = spinAngle(r);
    expect(held).toBeGreaterThan(60);
    expect(held % 180).not.toBe(0);
    for (let i = 0; i < 0.3 / STEP; i++) sim.step(none);
    expect(spinAngle(r)).toBe(held);
  });

  it('the TRICK key snaps an extra half turn', () => {
    const sim = jumper(true);
    sim.step({ steer: 1, trick: true });
    for (let i = 0; i < 0.3 / STEP; i++) sim.step(none);
    expect(Math.abs(spinAngle(sim.rider) - 180)).toBeLessThan(2);
  });

  it('never changes the flight path: x, y and speed ignore steering in the air, in both modes', () => {
    for (const manual of [false, true]) {
      const still = jumper(manual);
      const wild = jumper(manual);
      let steps = 0;
      while (steps < 2000) {
        still.step(none);
        wild.step({ steer: Math.sin(steps / 9) > 0 ? 1 : -1, trick: steps === 20 });
        // Touchdown itself depends on the angle (clean, sloppy, bail), so stop before it.
        if (!still.rider.air || !wild.rider.air) break;
        expect(wild.rider.x).toBe(still.rider.x);
        expect(wild.rider.y).toBe(still.rider.y);
        expect(wild.rider.speed).toBe(still.rider.speed);
        expect(wild.rider.hx).toBe(still.rider.hx);
        steps++;
      }
      expect(steps).toBeGreaterThan(50);
    }
  });

  it('lands a held 180 and 360 clean and pays the full degrees', () => {
    const half = jumper(true);
    const h = flight(half, 162);
    expect(h).toMatchObject({ quality: 'clean', spin: 180, switch: true });
    expect(h!.pts).toBeGreaterThan(0);

    const full = jumper(true);
    const f = flight(full, 342);
    expect(f).toMatchObject({ quality: 'clean', spin: 360, switch: false });
    expect(f!.pts).toBeGreaterThan(h!.pts);
    expect(full.score.trickPoints).toBe(f!.pts);
    expect(full.score.tricks).toBe(1);
  });

  it('a counter-clockwise 360 pays the same as a clockwise one', () => {
    const sim = jumper(true);
    expect(flight(sim, 342, -1)).toMatchObject({ quality: 'clean', spin: 360 });
  });

  it('a mistimed release is sloppy a little off a half turn and a bail at 90', () => {
    const sloppy = jumper(true);
    const s = flight(sloppy, 212);
    expect(s).toMatchObject({ quality: 'sloppy', pts: 0, spin: 0 });
    expect(sloppy.crashed).toBe(false);

    const bail = jumper(true);
    flight(bail, 72);
    expect(bail.crashed).toBe(true);
    expect(bail.crashCause).toBe('bail');
  });

  it('spinning back nets the angle: +180 then -180 pays no spin points', () => {
    const sim = jumper(true);
    const l = flight(sim, 162, 1, 18);
    expect(l).toMatchObject({ quality: 'clean', pts: 0, spin: 0, switch: false });
    expect(sim.score.trickPoints).toBe(0);
    expect(sim.score.tricks).toBe(0);
  });

  it('assisted mode is untouched by the setting being off', () => {
    const sim = jumper(false);
    for (let i = 0; i < 20; i++) sim.step({ steer: 1, trick: false });
    expect(sim.rider.spinGoal).toBeGreaterThan(0);
    expect(sim.rider.spinAng).toBe(0);
  });
});

describe('manual spin persistence', () => {
  it('is off by default and persists with the other settings', () => {
    expect(DEFAULT_SETTINGS.manualSpin).toBe(false);
    const st = memoryStorage();
    expect(new Store(st).settings().manualSpin).toBe(false);
    new Store(st).saveSettings({ manualSpin: true });
    const again = new Store(st).settings();
    expect(again.manualSpin).toBe(true);
    expect(again.muted).toBe(false);
  });

  it('replays carry the flag, and old replays default to assisted', () => {
    const rec = new ReplayRecorder();
    rec.record({ steer: 1, trick: false });
    const manual = rec.finish('s', false, 1, 1, true);
    expect(manual.manual).toBe(true);
    expect(isReplay(JSON.parse(JSON.stringify(manual)))).toBe(true);
    const plain = rec.finish('s', false, 1, 1);
    expect(plain.manual).toBeUndefined();
    expect(isReplay(plain)).toBe(true);
    expect(isReplay({ ...plain, manual: 'yes' })).toBe(false);
  });

  it('reproduces a manual spin run exactly from its replay', () => {
    const script = (i: number): SimInput => ({
      steer: i > 40 && i < 130 ? 1 : i > 200 && i < 260 ? -1 : 0,
      trick: i === 300,
    });
    const run = (src: (i: number) => SimInput, rec?: ReplayRecorder): Sim => {
      const sim = new Sim('manual-replay', { noAvalanche: true, manualSpin: true });
      sim.begin();
      for (let i = 0; i < 600 && !sim.crashed; i++) {
        if (i === 30) {
          sim.rider.speed = 150;
          launch(sim.rider, true);
        }
        const input = src(i);
        rec?.record(input);
        sim.step(input);
      }
      return sim;
    };
    const rec = new ReplayRecorder();
    const live = run(script, rec);
    const replay = rec.finish('manual-replay', false, live.scoreValue, live.distM, true);
    const player = new ReplayPlayer(replay);
    const copy = run((i) => player.at(i));
    expect(copy.opts.manualSpin).toBe(replay.manual);
    expect(copy.scoreValue).toBe(live.scoreValue);
    expect(copy.rider.x).toBe(live.rider.x);
    expect(copy.rider.spinAng).toBe(live.rider.spinAng);
    expect(copy.crashed).toBe(live.crashed);
  });
});
