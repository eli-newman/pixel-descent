import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/config';
import { Framebuffer } from '../src/render/framebuffer';
import { drawRider } from '../src/render/riderSprite';
import { heelSide, poseOf } from '../src/sim/pose';
import { launch, stepRider } from '../src/sim/rider';
import { createRider, type RiderState } from '../src/sim/riderState';
import { Sim, type SimInput } from '../src/sim/sim';
import { cruiseSpeed, topSpeed } from '../src/sim/speed';

const none: SimInput = { steer: 0, trick: false };

/** Put the sim's rider two steps from touchdown, `spin` degrees round. */
function spinNearLanding(sim: Sim, spin: number): void {
  const r = sim.rider;
  launch(r);
  r.speed = 150;
  r.hx = 0;
  r.hv = 0;
  r.spin = spin;
  r.spinDir = 1;
  r.spinGoal = Math.ceil(spin / 180) * 180;
  r.airT = r.airDur - STEP * 2;
}

/** Land the jump and return the landing event. */
function land(sim: Sim): { quality: string; spin: number; switch: boolean } | null {
  for (let i = 0; i < 5; i++) {
    sim.step(none);
    for (const e of sim.events) {
      if (e.type === 'land') return { quality: e.quality, spin: e.spin, switch: e.switch };
    }
  }
  return null;
}

function riding(): Sim {
  const sim = new Sim('stance');
  sim.begin();
  for (let i = 0; i < 5; i++) sim.step(none);
  return sim;
}

describe('stance', () => {
  it('starts every run regular', () => {
    expect(createRider().stance).toBe(1);
    expect(new Sim('stance').rider.stance).toBe(1);
  });

  it('lands a 180 switch and keeps it until another odd half turn swaps it back', () => {
    const sim = riding();
    const stances: number[] = [];
    const events: Array<{ spin: number; switch: boolean } | null> = [];
    for (const spin of [180, 360, 0, 540, 180, 720]) {
      spinNearLanding(sim, spin);
      const e = land(sim);
      events.push(e && { spin: e.spin, switch: e.switch });
      stances.push(sim.rider.stance);
    }
    expect(sim.crashed).toBe(false);
    expect(stances).toEqual([-1, -1, -1, 1, -1, -1]);
    // The event says how the rider rides away, so a 360 landed switch still lands switch.
    expect(events.map((e) => e?.switch)).toEqual([true, true, true, false, true, true]);
  });

  it('a sloppy 180 still lands switch, and a bail does not swap it', () => {
    const sloppy = riding();
    spinNearLanding(sloppy, 180 + 50);
    expect(land(sloppy)).toMatchObject({ quality: 'sloppy', switch: true });
    expect(sloppy.rider.stance).toBe(-1);

    const bail = riding();
    spinNearLanding(bail, 180 + 80);
    land(bail);
    expect(bail.crashed).toBe(true);
    expect(bail.rider.stance).toBe(1);
  });

  it('steers exactly the same riding switch', () => {
    const env = {
      cruise: cruiseSpeed(500),
      top: topSpeed(500),
      surface: { ice: false, drift: false },
    };
    const ride = (stance: 1 | -1): RiderState => {
      const r = createRider();
      r.stance = stance;
      r.speed = 120;
      for (let i = 0; i < 240; i++) stepRider(r, i < 120 ? 1 : -0.5, STEP, env);
      return r;
    };
    const regular = ride(1);
    const sw = ride(-1);
    expect({ ...sw, stance: 1 }).toEqual(regular);
  });
});

describe('stance on screen', () => {
  const W = 64;
  const H = 64;
  function draw(r: Readonly<RiderState>, x = 32, skis = false): Framebuffer {
    const fb = new Framebuffer(W, H);
    fb.clear();
    drawRider(fb, poseOf(r, x, 36, 0), skis ? { style: { board: 0, rider: 0, skis } } : undefined);
    return fb;
  }
  function differing(a: Framebuffer, b: Framebuffer, mirror = false): number {
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (a.isOn(x, y) !== b.isOn(mirror ? W - 1 - x : x, y)) n++;
    }
    return n;
  }
  function carving(hx: number, stance: 1 | -1): RiderState {
    const r = createRider();
    r.hx = hx;
    r.face = hx > 0 ? 1 : -1;
    r.steep = false;
    r.stance = stance;
    return r;
  }

  it('riding switch shows the other side of the rider: the mirror of a regular rider heading the other way', () => {
    const offenders: string[] = [];
    for (const hx of [0.3, 0.5, 0.8]) {
      const sw = draw(carving(hx, -1), 20);
      const regular = draw(carving(hx, 1), 20);
      // Board on the same pixels, rider not.
      if (differing(sw, regular) < 15) offenders.push(`switch looks regular at ${hx}`);
      // Mirrored about the canvas middle, the board tail of the left-heading rider sits at W - 1 - 20.
      const mirrored = draw(carving(-hx, 1), W - 1 - 20);
      const off = differing(sw, mirrored, true);
      if (off > 10) offenders.push(`switch at ${hx} is ${off} px off the mirrored regular pose`);
    }
    expect(offenders).toEqual([]);
  });

  it('a switch skier rides backwards: turned up the hill, face to the camera when pointing straight down', () => {
    const offenders: string[] = [];
    // From the side the whole body turns round; square on only the head does (goggles instead of the back of the helmet).
    for (const [hx, steep, least] of [
      [0.3, false, 15],
      [0.8, false, 15],
      [-0.5, false, 15],
      [0.02, true, 3],
    ] as const) {
      const sw = carving(hx, -1);
      const regular = carving(hx, 1);
      sw.steep = regular.steep = steep;
      const off = differing(draw(sw, 32, true), draw(regular, 32, true));
      if (off < least) offenders.push(`skier at ${hx} looks the same switch (${off} px apart)`);
    }
    expect(offenders).toEqual([]);
  });

  it('a half turn ends in the air showing the side the rider lands on, so touchdown does not turn him round', () => {
    const offenders: string[] = [];
    for (const [spin, steer] of [
      [180, 1],
      [180, -1],
      [360, 1],
      [540, -1],
    ] as const) {
      for (const stance of [1, -1] as const) {
        for (const hx of [-0.3, 0.02, 0.3]) {
          const sim = riding();
          const r = sim.rider;
          r.stance = stance;
          r.speed = 220;
          launch(r, true);
          r.hx = hx;
          r.face = hx > 0 ? 1 : -1;
          let heel = heelSide(poseOf(r, 90, 100, 0));
          for (let i = 0; i < 2000 && r.air; i++) {
            const turning = r.spin < spin - 180 || (r.spin < spin && r.spinGoal < spin);
            sim.step({ steer: turning ? steer : 0, trick: false });
            if (r.air) heel = heelSide(poseOf(r, 90, 100, 0));
          }
          const want = (spin / 180) % 2 === 1 ? -stance : stance;
          const tag = `${spin} ${steer} from ${stance} at ${hx}`;
          if (sim.crashed || r.stance !== want) offenders.push(`${tag}: lands ${r.stance}`);
          else if (heelSide(poseOf(r, 90, 100, 0)) !== heel) offenders.push(`${tag}: turns round`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
