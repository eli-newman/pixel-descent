import { describe, expect, it } from 'vitest';
import { H, STEP, W } from '../src/core/config';
import { Framebuffer, YELLOW } from '../src/render/framebuffer';
import { riderBox } from '../src/render/layout';
import { SceneRenderer } from '../src/render/scene';
import { renderUi } from '../src/render/ui';
import { COLOR, MONO } from '../src/render/palette';
import { drawRider } from '../src/render/riderSprite';
import { poseOf } from '../src/sim/pose';
import { headingAngle, launch } from '../src/sim/rider';
import { createRider } from '../src/sim/riderState';
import {
  addGrab,
  createScore,
  GRAB_BASE,
  GRAB_COMBO,
  GRAB_PER_S,
  grabPoints,
  spinPoints,
} from '../src/sim/score';
import { Sim, type SimEvent, type SimInput } from '../src/sim/sim';
import { GRAB_MIN } from '../src/sim/tricks';
import { Feedback } from '../src/state/feedback';
import type { Sfx } from '../src/platform/audio';
import { FakeSfx, makeGame } from './helpers/fakes';

const none: SimInput = { steer: 0, trick: false };

/** A sim with the rider launched into the air, as a kicker hop or a cliff drop. */
function jumper(opts: { cliff?: boolean; speed?: number; manual?: boolean } = {}): Sim {
  const sim = new Sim('grab-test', { manualSpin: opts.manual === true });
  sim.begin();
  for (let i = 0; i < 5; i++) sim.step(none);
  const r = sim.rider;
  r.speed = opts.speed ?? 150;
  r.hx = 0;
  r.hv = 0;
  launch(r, opts.cliff !== false);
  return sim;
}

interface Result {
  land: Extract<SimEvent, { type: 'land' }> | null;
  grabs: number;
  crashed: boolean;
  tricks: number;
}

/** Run to touchdown, calling `input(step, sim)` each step. */
function fly(sim: Sim, input: (i: number, sim: Sim) => SimInput): Result {
  const out: Result = { land: null, grabs: 0, crashed: false, tricks: 0 };
  for (let i = 0; i < 3000 && !out.land && !sim.crashed; i++) {
    sim.step(input(i, sim));
    for (const e of sim.events) {
      if (e.type === 'land') out.land = e;
      if (e.type === 'grab') out.grabs++;
    }
  }
  out.crashed = sim.crashed;
  out.tricks = sim.score.tricks;
  return out;
}

/** Hold the grab for the first `steps` steps of the jump, then let go. */
const grabFor =
  (steps: number, extra: Partial<SimInput> = {}) =>
  (i: number): SimInput => ({ ...none, ...extra, grab: i < steps });

describe('grab scoring', () => {
  it('pays nothing under GRAB_MIN, then grows with the time held', () => {
    expect(grabPoints(GRAB_MIN - 0.01, GRAB_MIN)).toBe(0);
    expect(grabPoints(GRAB_MIN, GRAB_MIN)).toBe(GRAB_BASE);
    expect(grabPoints(GRAB_MIN + 0.5, GRAB_MIN)).toBe(GRAB_BASE + GRAB_PER_S / 2);
    expect(grabPoints(1, GRAB_MIN)).toBeGreaterThan(grabPoints(0.5, GRAB_MIN));
  });

  it('a grabbed spin pays the grab, the spin and a style bonus on the spin, times the speed', () => {
    const s = createScore();
    const pts = addGrab(s, 0.65, GRAB_MIN, spinPoints(360), 2);
    expect(pts).toBe(Math.round((70 + spinPoints(360) * GRAB_COMBO) * 2));
    expect(s.tricks).toBe(1);
    expect(s.trickPoints).toBe(pts);
    const none = createScore();
    expect(addGrab(none, 0.1, GRAB_MIN, spinPoints(360), 2)).toBe(0);
    expect(none.tricks).toBe(0);
  });
});

describe('grabs in the sim', () => {
  it('holding the grab in the air and letting go lands clean and pays for the time held', () => {
    const sim = jumper();
    const res = fly(sim, grabFor(60));
    expect(res.grabs).toBe(1);
    expect(res.land?.quality).toBe('clean');
    expect(res.land?.grab).toBeCloseTo(60 * STEP, 5);
    expect(res.land?.tricks).toBe(1);
    expect(res.tricks).toBe(1);
    // A cliff also pays its drop bonus, so take that out: the rest is the grab.
    const plain = fly(jumper(), () => none);
    expect(plain.land?.quality).toBe('clean');
    expect((res.land?.pts ?? 0) - (plain.land?.pts ?? 0)).toBeGreaterThan(0);
  });

  it('a longer hold is worth more', () => {
    const short = fly(jumper(), grabFor(30));
    const long = fly(jumper(), grabFor(100));
    expect(long.land?.pts ?? 0).toBeGreaterThan(short.land?.pts ?? 0);
  });

  it('a tap shorter than GRAB_MIN is no grab: no toast, no points, no trick', () => {
    const res = fly(jumper(), grabFor(Math.floor(GRAB_MIN / STEP) - 2));
    expect(res.grabs).toBe(0);
    expect(res.land?.quality).toBe('clean');
    expect(res.land?.grab).toBe(0);
    expect(res.tricks).toBe(0);
  });

  it('a grabbed 360 is worth more than a plain 360', () => {
    const spin = (grab: boolean): Result =>
      fly(jumper(), (i) => ({ ...none, trick: i === 0, grab: grab && i < 60 }));
    const plain = spin(false);
    const grabbed = spin(true);
    expect(plain.land?.spin).toBe(360);
    expect(grabbed.land?.spin).toBe(360);
    expect(grabbed.land?.quality).toBe('clean');
    expect(grabbed.land?.tricks).toBe(2);
    expect(grabbed.land?.pts ?? 0).toBeGreaterThan(plain.land?.pts ?? 0);
  });

  it('landing still grabbing is sloppy: speed scrubbed, combo broken, nothing paid', () => {
    const sim = jumper();
    const res = fly(sim, () => ({ ...none, grab: true }));
    expect(res.crashed).toBe(false);
    expect(res.land?.quality).toBe('sloppy');
    expect(res.land?.held).toBe(true);
    expect(res.land?.pts).toBe(0);
    expect(res.tricks).toBe(0);
    // A grabbed 360 held into the snow is sloppy too.
    const spun = fly(jumper(), (i) => ({ ...none, trick: i === 0, grab: true }));
    expect(spun.land?.spin).toBe(0);
    expect(spun.land?.quality).toBe('sloppy');
  });

  it('landing still grabbing after a flip or a 540 or more is a bail', () => {
    const flip = fly(jumper(), (i) => ({ ...none, flip: i === 0 ? 1 : 0, grab: true }));
    expect(flip.crashed).toBe(true);
    expect(flip.land).toBeNull();
    // A fast cliff drop has the air for a 720: hold right the whole way, grabbing.
    const big = fly(jumper({ speed: 300 }), () => ({ steer: 1, trick: false, grab: true }));
    expect(big.crashed).toBe(true);
    // Let go in time and both land clean.
    const flipOk = fly(jumper(), (i) => ({ ...none, flip: i === 0 ? 1 : 0, grab: i < 60 }));
    expect(flipOk.land?.quality).toBe('clean');
    expect(flipOk.land?.grab).toBeGreaterThan(0);
    const bigOk = fly(jumper({ speed: 300 }), (i) => ({ steer: 1, trick: false, grab: i < 60 }));
    expect(bigOk.land?.quality).toBe('clean');
    expect(bigOk.land?.spin).toBeGreaterThanOrEqual(540);
  });

  it('works the same in manual spin', () => {
    const res = fly(jumper({ manual: true }), grabFor(60));
    expect(res.land?.quality).toBe('clean');
    expect(res.land?.grab).toBeGreaterThan(0);
  });

  it('does nothing on the snow, and a grab held from the snow starts once airborne', () => {
    const sim = new Sim('grab-ground');
    sim.begin();
    for (let i = 0; i < 200; i++) {
      sim.step({ ...none, grab: true });
      if (sim.events.some((e) => e.type === 'grab')) throw new Error('grabbed on the snow');
    }
    expect(sim.rider.grab).toBe(false);
    expect(sim.rider.grabT).toBe(0);
  });

  it('is deterministic: the same inputs with grabs play the same run', () => {
    const play = (): string[] => {
      const { game, input } = makeGame('grab-same');
      input.push('start');
      const log: string[] = [];
      for (let i = 0; i < 120 * 30 && !game.sim.crashed; i++) {
        const r = game.sim.rider;
        input.grabValue = r.air && r.airT < 0.4;
        if (r.air && r.airT === 0) input.push('trick');
        game.update(1 / 120);
        if (i % 60 === 0) log.push(JSON.stringify([game.sim.rider, game.sim.scoreValue]));
      }
      return log;
    };
    expect(play()).toEqual(play());
  });
});

describe('grab feedback', () => {
  const feedback = (): Feedback => new Feedback(new FakeSfx() as unknown as Sfx, () => {});
  const land = (over: Partial<Extract<SimEvent, { type: 'land' }>>): SimEvent => ({
    type: 'land',
    quality: 'clean',
    pts: 100,
    tricks: 1,
    spin: 0,
    switch: false,
    flips: 0,
    grab: 0.5,
    held: false,
    ...over,
  });

  it('says GRAB! in the air and names the grab on landing', () => {
    const f = feedback();
    f.react({ type: 'grab' }, 0);
    expect(f.toasts[0]?.text).toBe('GRAB!');
    f.react(land({}), 0);
    expect(f.toasts[0]?.text).toBe('GRAB +100');
    f.react(land({ spin: 360 }), 0);
    expect(f.toasts[0]?.text).toBe('360 GRAB +100');
    f.react(land({ spin: 540, flips: 1, switch: true }), 0);
    expect(f.toasts[0]?.text).toBe('540 FRONTFLIP GRAB +100');
    f.react(land({ grab: 0, spin: 360, pts: 70 }), 0);
    expect(f.toasts[0]?.text).toBe('CLEAN LANDING +70');
  });

  it('tells the player why a held landing was sloppy', () => {
    const f = feedback();
    f.react(land({ quality: 'sloppy', pts: 0, grab: 0, held: true }), 0);
    expect(f.toasts[0]?.text).toBe('STILL GRABBING');
    expect(f.toasts[0]?.hot).toBe(false);
    f.react(land({ quality: 'sloppy', pts: 0, grab: 0, held: false }), 0);
    expect(f.toasts[0]?.text).toBe('SLOPPY LANDING');
  });
});

describe('the grab pose', () => {
  /** Every heading, both stances, with and without a spin or flip. */
  function cases(): { name: string; set: (r: ReturnType<typeof createRider>) => void }[] {
    const out: { name: string; set: (r: ReturnType<typeof createRider>) => void }[] = [];
    for (const hx of [0, -0.3, -0.6, -0.9, 0.3, 0.6, 0.9]) {
      for (const stance of [1, -1] as const) {
        out.push({
          name: `hx ${hx} stance ${stance}`,
          set: (r) => {
            r.hx = hx;
            r.face = hx > 0.05 ? 1 : -1;
            r.steep = headingAngle(hx) > 70;
            r.stance = stance;
          },
        });
      }
    }
    for (let s = 45; s < 360; s += 45) {
      out.push({
        name: `spin ${s}`,
        set: (r) => {
          r.spin = s;
          r.spinDir = 1;
        },
      });
    }
    for (let p = 45; p < 360; p += 45) out.push({ name: `flip ${p}`, set: (r) => (r.pitch = p) });
    return out;
  }

  const draw = (
    set: (r: ReturnType<typeof createRider>) => void,
    grab: boolean,
    skis: boolean,
    color: boolean,
  ): Framebuffer => {
    const r = createRider();
    r.air = true;
    set(r);
    r.grab = grab;
    const pal = color ? COLOR : MONO;
    const fb = new Framebuffer(W, H);
    fb.clear(pal.snow);
    drawRider(fb, poseOf(r, 90, 160, 0), { style: { board: 0, rider: 0, skis }, palette: pal });
    return fb;
  };

  const same = (a: Framebuffer, b: Framebuffer): boolean => a.data.every((v, i) => v === b.data[i]);

  it('is drawn in every board, ski, stance, colour, spin and flip combination', () => {
    const missing: string[] = [];
    for (const skis of [false, true]) {
      for (const color of [false, true]) {
        for (const { name, set } of cases()) {
          const grabbed = draw(set, true, skis, color);
          if (same(grabbed, draw(set, false, skis, color))) {
            missing.push(`${skis ? 'skis' : 'board'} ${color ? 'colour' : 'mono'} ${name}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only uses the rider colours, and the skier grab is its own drawing', () => {
    const stray: string[] = [];
    for (const skis of [false, true]) {
      for (const color of [false, true]) {
        const pal = color ? COLOR : MONO;
        const allowed = new Set([pal.snow, pal.riderBody, pal.riderBoard, pal.riderHalo]);
        for (const { name, set } of cases()) {
          const px = new Uint32Array(draw(set, true, skis, color).data.buffer);
          if (px.some((v) => !allowed.has(v))) stray.push(`${skis} ${color} ${name}`);
        }
      }
    }
    expect(stray).toEqual([]);
    const set = cases()[4]?.set ?? (() => {});
    expect(same(draw(set, true, true, false), draw(set, true, false, false))).toBe(false);
  });
});

describe('toasts and the airborne rider', () => {
  it('a toast never covers the rider at the top of a jump: it moves under him', () => {
    const { game, input } = makeGame('toast-air');
    input.push('start');
    for (let i = 0; i < 6; i++) game.update(STEP);
    const r = game.sim.rider;
    r.speed = 300;
    r.hx = 0;
    r.hv = 0;
    launch(r, true);
    input.grabValue = true;
    let peak = false;
    for (let i = 0; i < 600 && !peak; i++) {
      game.update(STEP);
      peak = r.air && r.airT >= r.airDur / 2;
    }
    expect(game.toasts[0]?.text).toBe('GRAB!');
    const scene = new SceneRenderer(new Framebuffer(W, H));
    const fb = scene.render(game);
    renderUi(fb, game);
    const box = riderBox(game.sim, game.camYi);
    let inBox = 0;
    let total = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (fb.get(x, y) !== YELLOW) continue;
        total++;
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) inBox++;
      }
    }
    expect(box.top).toBeLessThan(52);
    expect(total).toBeGreaterThan(20);
    expect(inBox).toBe(0);
  });
});
