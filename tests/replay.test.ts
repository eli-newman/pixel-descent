import { describe, expect, it } from 'vitest';
import { ReplayPlayer, ReplayRecorder, isReplay } from '../src/replay';
import { Sim, quantiseSteer, type SimInput } from '../src/sim';

describe('replay', () => {
  it('reproduces a run exactly from the recorded inputs', () => {
    const script = (i: number): SimInput => ({
      steer: Math.sin(i / 70) * 0.8,
      trick: i % 733 === 0,
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
    ];
    for (const i of inputs) rec.record(i);
    const p = new ReplayPlayer(rec.finish('s', true, 1, 1));
    inputs.forEach((want, i) => {
      const got = p.at(i);
      expect(got.steer).toBe(quantiseSteer(want.steer));
      expect(got.trick).toBe(want.trick);
    });
  });

  it('rejects malformed data', () => {
    expect(isReplay(null)).toBe(false);
    expect(isReplay({ seed: 's', touch: false, steps: 1, score: 1, changes: [1] })).toBe(false);
    expect(isReplay({ seed: 's', touch: false, steps: 1, score: 1, changes: ['a', 'b'] })).toBe(
      false,
    );
  });
});
