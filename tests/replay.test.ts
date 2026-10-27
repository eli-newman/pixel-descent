import { describe, expect, it } from 'vitest';
import { ReplayPlayer, ReplayRecorder, isReplay, type Replay } from '../src/replay';
import { Sim, quantiseSteer, type SimInput } from '../src/sim';
import { botInput } from './helpers/bot';

describe('replay', () => {
  it('reproduces a run exactly from the recorded inputs', () => {
    const script = (i: number): SimInput => ({
      steer: Math.sin(i / 70) * 0.8,
      trick: i % 733 === 0,
      brake: i % 900 < 60,
    });
    const live = new Sim('ghost-seed');
    const rec = new ReplayRecorder();
    live.begin();
    for (let i = 0; i < 9000 && !live.crashed; i++) {
      const input = script(i);
      rec.record(input);
      live.step(input);
    }
    const replay = rec.finish('ghost-seed', false, live.scoreValue, live.distM);
    expect(isReplay(JSON.parse(JSON.stringify(replay)))).toBe(true);
    expect(replay.changes.length).toBeLessThan(replay.steps);

    const copy = new Sim('ghost-seed');
    const player = new ReplayPlayer(replay);
    copy.begin();
    for (let i = 0; i < replay.steps; i++) copy.step(player.at(i));
    expect(copy.scoreValue).toBe(live.scoreValue);
    expect(copy.rider.x).toBe(live.rider.x);
    expect(copy.rider.y).toBe(live.rider.y);
    expect(copy.crashed).toBe(live.crashed);
  });

  it('round trips steering and tricks', () => {
    const rec = new ReplayRecorder();
    const inputs: SimInput[] = [
      { steer: 0, trick: false },
      { steer: 1, trick: false },
      { steer: -1, trick: true },
      { steer: 0.37, trick: false },
      { steer: 0, trick: false, brake: true },
    ];
    for (const i of inputs) rec.record(i);
    const p = new ReplayPlayer(rec.finish('s', true, 1, 1));
    inputs.forEach((want, i) => {
      const got = p.at(i);
      expect(got.steer).toBe(quantiseSteer(want.steer));
      expect(got.trick).toBe(want.trick);
      expect(got.brake).toBe(want.brake === true);
    });
  });

  it('replays a run with spins in the air exactly', () => {
    // Hold a direction or press the trick button whenever airborne; otherwise steer gently.
    const live = new Sim('spin-replay', { noAvalanche: true, forceSpeed: true });
    const rec = new ReplayRecorder();
    live.begin();
    let spins = 0;
    let wasAir = false;
    for (let i = 0; i < 60000 && !live.crashed && spins < 3; i++) {
      const air = live.rider.air;
      if (air && !wasAir) spins++;
      wasAir = air;
      const input: SimInput = air
        ? { steer: spins % 2 === 0 ? 1 : -0.75, trick: spins === 2 && live.rider.airT < 0.02 }
        : botInput(live);
      rec.record(input);
      live.step(input);
    }
    expect(spins).toBeGreaterThanOrEqual(2);
    expect(live.score.tricks).toBeGreaterThan(0);
    const replay = rec.finish('spin-replay', false, live.scoreValue, live.distM);
    const copy = new Sim('spin-replay', { noAvalanche: true, forceSpeed: true });
    const player = new ReplayPlayer(JSON.parse(JSON.stringify(replay)) as Replay);
    copy.begin();
    for (let i = 0; i < replay.steps; i++) copy.step(player.at(i));
    expect(copy.scoreValue).toBe(live.scoreValue);
    expect(copy.score.trickPoints).toBe(live.score.trickPoints);
    expect(copy.score.tricks).toBe(live.score.tricks);
    expect(copy.rider.x).toBe(live.rider.x);
    expect(copy.rider.spin).toBe(live.rider.spin);
    expect(copy.crashed).toBe(live.crashed);
  });

  it('rejects malformed data', () => {
    expect(isReplay(null)).toBe(false);
    expect(isReplay({ seed: 's', touch: false, steps: 1, score: 1, changes: [1] })).toBe(false);
    expect(isReplay({ seed: 's', touch: false, steps: 1, score: 1, changes: ['a', 'b'] })).toBe(
      false,
    );
  });
});
