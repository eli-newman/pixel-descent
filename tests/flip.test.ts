import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEP } from '../src/config';
import { Input } from '../src/input';
import { ReplayPlayer, ReplayRecorder } from '../src/replay';
import { launch, flipCap, flipLanding, FLIP_RATE, MANUAL_FLIP_RATE } from '../src/rider';
import { addFlip, flipName, flipPoints, createScore, spinPoints } from '../src/score';
import { Sim, type SimEvent, type SimInput } from '../src/sim';
import { makeGame } from './helpers/fakes';

const none: SimInput = { steer: 0, trick: false };

/** A sim with the rider launched into the air, as a kicker hop or a cliff drop. */
function jumper(opts: { manual?: boolean; cliff?: boolean; speed?: number } = {}): Sim {
  const sim = new Sim('flip-test', { noAvalanche: true, manualSpin: opts.manual === true });
  sim.begin();
  for (let i = 0; i < 5; i++) sim.step(none);
  const r = sim.rider;
  r.speed = opts.speed ?? 150;
  r.hx = 0;
  r.hv = 0;
  launch(r, opts.cliff === true);
  return sim;
}

interface Result {
  land: Extract<SimEvent, { type: 'land' }> | null;
  flips: number[];
  crashed: boolean;
}

/** Run to touchdown, calling `input(step, sim)` each step. */
function fly(sim: Sim, input: (i: number, sim: Sim) => SimInput): Result {
  const out: Result = { land: null, flips: [], crashed: false };
  for (let i = 0; i < 3000 && !out.land && !sim.crashed; i++) {
    sim.step(input(i, sim));
    for (const e of sim.events) {
      if (e.type === 'land') out.land = e;
      if (e.type === 'flip') out.flips.push(e.deg);
    }
  }
  out.crashed = sim.crashed;
  return out;
}

describe('assisted flips', () => {
  it('a press starts a full flip that finishes on 360 and lands clean', () => {
    const sim = jumper({ cliff: true });
    const res = fly(sim, (i) => ({ ...none, flip: i === 0 ? 1 : 0 }));
    expect(res.flips).toEqual([360]);
    expect(res.land?.quality).toBe('clean');
    expect(res.land?.flips).toBe(1);
    expect(res.land?.pts).toBeGreaterThanOrEqual(80);
  });

  it('turns at the flip rate, backflip positive and frontflip negative', () => {
    for (const dir of [1, -1] as const) {
      const sim = jumper({ cliff: true });
      sim.step({ ...none, flip: dir });
      for (let i = 0; i < 10; i++) sim.step(none);
      const expected = FLIP_RATE * STEP * 11;
      expect(sim.rider.pitch).toBeCloseTo(dir * expected, 3);
    }
  });

  it('is ignored on a kicker hop with too little air, and never leaves a half flip', () => {
    const sim = jumper({ speed: 120 });
    expect(flipCap(sim.rider)).toBe(0);
    const res = fly(sim, (i) => ({ ...none, flip: i === 0 ? 1 : 0 }));
    expect(res.flips).toEqual([]);
    expect(res.land?.flips).toBe(0);
    expect(res.land?.quality).toBe('clean');
  });

  it('a faster kicker allows one flip, a big cliff allows two and caps there', () => {
    const fast = jumper({ speed: 340 });
    expect(flipCap(fast.rider)).toBe(360);
    const cliff = jumper({ cliff: true, speed: 250 });
    expect(flipCap(cliff.rider)).toBe(720);
    // Mashing the key never goes past two flips, and always finishes before touchdown.
    const res = fly(cliff, (i) => ({ ...none, flip: i % 20 < 10 ? 1 : 0 }));
    expect(res.land?.flips).toBe(2);
    expect(res.land?.quality).toBe('clean');
  });

  it('holding the key keeps flipping while the air time allows', () => {
    const res = fly(jumper({ cliff: true, speed: 250 }), () => ({ ...none, flip: -1 }));
    expect(res.land?.flips).toBe(-2);
    expect(res.land?.quality).toBe('clean');
  });

  it('flips do not change the flight path', () => {
    const a = jumper({ cliff: true });
    const b = jumper({ cliff: true });
    for (let i = 0; i < 30; i++) {
      a.step({ ...none, flip: 1 });
      b.step(none);
    }
    expect(a.rider.x).toBe(b.rider.x);
    expect(a.rider.y).toBe(b.rider.y);
  });

  it('combines with a spin: both land, and the combo pays extra', () => {
    const sim = jumper({ cliff: true, speed: 250 });
    sim.step({ ...none, trick: true, steer: 1, flip: 1 });
    const res = fly(sim, () => none);
    expect(res.land?.flips).toBe(1);
    expect(res.land?.spin).toBe(360);
    expect(res.land?.quality).toBe('clean');
    const mult = 1;
    const base = flipPoints(1) + spinPoints(360);
    expect(res.land?.pts).toBeGreaterThanOrEqual(Math.round(base * 1.5 * mult));
    expect(sim.score.tricks).toBe(2);
  });
});

describe('manual flips', () => {
  it('pitches at a fixed rate while held, and holds the angle on release', () => {
    const sim = jumper({ manual: true, cliff: true });
    for (let i = 0; i < 60; i++) sim.step({ ...none, flip: 1 });
    const turning = sim.rider.pitch;
    expect(turning).toBeGreaterThan(MANUAL_FLIP_RATE * 60 * STEP * 0.9);
    expect(turning).toBeLessThan(MANUAL_FLIP_RATE * 60 * STEP + 1);
    for (let i = 0; i < 20; i++) sim.step(none);
    const held = sim.rider.pitch;
    for (let i = 0; i < 30; i++) sim.step(none);
    expect(sim.rider.pitch).toBe(held);
    for (let i = 0; i < 30; i++) sim.step({ ...none, flip: -1 });
    expect(sim.rider.pitch).toBeLessThan(held);
  });

  /** Hold until the pitch passes `target`, then let go and land. */
  function landAt(target: number, back?: number): Result {
    const sim = jumper({ manual: true, cliff: true, speed: 250 });
    let phase = 0;
    return fly(sim, (_i, s) => {
      const p = s.rider.pitch;
      if (phase === 0) {
        if (p < target) return { ...none, flip: 1 };
        phase = back === undefined ? 2 : 1;
      }
      if (phase === 1) {
        if (p > back!) return { ...none, flip: -1 };
        phase = 2;
      }
      return none;
    });
  }

  it('lands a full turn clean, a half turn as a bail, and nets backflip then frontflip to nothing', () => {
    const clean = landAt(355);
    expect(clean.land?.quality).toBe('clean');
    expect(clean.land?.flips).toBe(1);
    expect(clean.flips).toEqual([360]);

    const half = landAt(180);
    expect(half.land).toBeNull();
    expect(half.crashed).toBe(true);

    const net = landAt(120, 5);
    expect(net.land?.quality).toBe('clean');
    expect(net.land?.flips).toBe(0);
  });
});

describe('flip landing judge', () => {
  it('normalises to the nearest full turn', () => {
    const sim = jumper();
    const r = sim.rider;
    r.pitch = 330;
    expect(flipLanding(r)).toEqual({ turns: 1, off: 30 });
    r.pitch = -725;
    expect(flipLanding(r).turns).toBe(-2);
    r.pitch = 180;
    expect(flipLanding(r).off).toBe(180);
    r.pitch = 20;
    expect(flipLanding(r).turns).toBe(0);
  });

  it('is sloppy between 40 and 70 degrees off a full turn and a bail beyond', () => {
    const run = (pitch: number): Result => {
      const sim = jumper();
      sim.rider.pitch = pitch;
      return fly(sim, () => none);
    };
    expect(run(350).land?.quality).toBe('clean');
    expect(run(300).land?.quality).toBe('sloppy');
    expect(run(280).crashed).toBe(true);
    expect(run(-300).land?.quality).toBe('sloppy');
  });
});

describe('flip scoring', () => {
  it('pays by number of flips, with a combo bonus for a spin', () => {
    expect([1, 2, 3].map(flipPoints)).toEqual([80, 220, 400]);
    const s = createScore();
    expect(addFlip(s, 2, 0, 1)).toBe(220);
    expect(s.tricks).toBe(2);
    const c = createScore();
    expect(addFlip(c, 1, 360, 2)).toBe(Math.round(80 * 2 + (80 + 70) * 0.5 * 2));
    expect(c.trickPoints).toBe(310);
  });

  it('names the tricks', () => {
    expect(flipName(1)).toBe('BACKFLIP');
    expect(flipName(-1)).toBe('FRONTFLIP');
    expect(flipName(-2)).toBe('DOUBLE FRONTFLIP');
    expect(flipName(2)).toBe('DOUBLE BACKFLIP');
  });
});

describe('flip replays', () => {
  it('round trips the flip input and plays old inputs with no flips', () => {
    const rec = new ReplayRecorder();
    const inputs: SimInput[] = [
      { steer: 0, trick: false },
      { steer: 0.5, trick: false, flip: 1 },
      { steer: -1, trick: true, flip: -1 },
      { steer: 0, trick: false, brake: true, flip: 0 },
    ];
    for (const i of inputs) rec.record(i);
    const p = new ReplayPlayer(rec.finish('s', false, 1, 1));
    expect(inputs.map((_, i) => p.at(i).flip)).toEqual([0, 1, -1, 0]);
    const old = new ReplayPlayer({
      seed: 's',
      touch: false,
      steps: 2,
      score: 0,
      dist: 0,
      changes: [0, 8 + 8, 1, 8 | 64 | 128],
    });
    expect(old.at(0).flip).toBe(0);
    expect(old.at(1).flip).toBe(0);
    expect(old.at(1).trick).toBe(true);
    expect(old.at(1).brake).toBe(true);
  });

  it('reproduces a run with flips exactly', () => {
    const script = (i: number): SimInput => ({
      steer: 0,
      trick: false,
      flip: i % 400 < 5 ? 1 : i % 400 === 200 ? -1 : 0,
    });
    const live = new Sim('flip-replay', { noAvalanche: true });
    const rec = new ReplayRecorder();
    live.begin();
    for (let i = 0; i < 4000 && !live.crashed; i++) {
      const input = script(i);
      rec.record(input);
      live.step(input);
    }
    const replay = rec.finish('flip-replay', false, live.scoreValue, live.distM);
    const copy = new Sim('flip-replay', { noAvalanche: true });
    const player = new ReplayPlayer(replay);
    copy.begin();
    for (let i = 0; i < replay.steps; i++) copy.step(player.at(i));
    expect(copy.scoreValue).toBe(live.scoreValue);
    expect(copy.rider.y).toBe(live.rider.y);
    expect(copy.score.tricks).toBe(live.score.tricks);
  });
});

describe('flip input', () => {
  afterEach(() => vi.unstubAllGlobals());

  function keyboard(): {
    input: Input;
    press: (code: string) => void;
    release: (c: string) => void;
  } {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const input = new Input({ getBoundingClientRect: () => ({}) } as unknown as HTMLCanvasElement);
    const fire = (type: string, code: string): void => {
      win.dispatchEvent(
        Object.assign(new Event(type), {
          code,
          repeat: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        }),
      );
    };
    return { input, press: (c) => fire('keydown', c), release: (c) => fire('keyup', c) };
  }

  it('Up/W and Down/S are flips, and no longer the trick key', () => {
    const { input, press, release } = keyboard();
    for (const code of ['ArrowUp', 'KeyW']) {
      press(code);
      expect(input.flip()).toBe(-1);
      release(code);
    }
    for (const code of ['ArrowDown', 'KeyS']) {
      press(code);
      expect(input.flip()).toBe(1);
      release(code);
    }
    expect(input.flip()).toBe(0);
    press('ArrowUp');
    press('ArrowDown');
    expect(input.flip()).toBe(0);
    release('ArrowUp');
    release('ArrowDown');
    input.drain();
    for (const code of ['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS']) {
      press(code);
      release(code);
    }
    expect(input.drain().some((i) => i.kind === 'action' && i.action === 'trick')).toBe(false);
    for (const code of ['Space', 'KeyT']) {
      press(code);
      release(code);
    }
    const trick = input.drain().filter((i) => i.kind === 'action' && i.action === 'trick');
    expect(trick).toHaveLength(1);
    input.dispose();
  });

  it('the game turns up, down and the touch buttons into a flip, and up is not a trick', () => {
    const { game, input } = makeGame('flip-input');
    input.push('start');
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    const sent: Array<SimInput | undefined> = [];
    const step = game.sim.step.bind(game.sim);
    game.sim.step = (i, dt) => {
      sent.push({ ...i });
      step(i, dt);
    };
    input.push('up');
    game.update(1 / 120);
    input.push('flipDown');
    game.update(1 / 120);
    input.flipValue = 1;
    game.update(1 / 120);
    expect(sent.map((s) => s?.flip)).toEqual([1, -1, 1]);
    expect(sent.some((s) => s?.trick)).toBe(false);
  });
});
