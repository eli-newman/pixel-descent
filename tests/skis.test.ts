import { describe, expect, it } from 'vitest';
import { H, SAVE_PREFIX, W } from '../src/core/config';
import { Framebuffer, GREY, WHITE } from '../src/render/framebuffer';
import { drawRider, drawWipeout, type RiderStyle } from '../src/render/riderSprite';
import { TrackPainter } from '../src/render/track';
import { PROBE } from './helpers/probe';
import { poseOf, type RiderPose } from '../src/sim/pose';
import { headingAngle } from '../src/sim/rider';
import { createRider } from '../src/sim/riderState';
import { Trail } from '../src/sim/trail';
import { Store } from '../src/state/storage';
import { botInput } from './helpers/bot';
import { makeGame, memoryStorage } from './helpers/fakes';

const BOARD: RiderStyle = { board: 0, rider: 0, skis: false };
const SKIS: RiderStyle = { board: 0, rider: 0, skis: true };

describe('choosing skis', () => {
  it('is remembered between visits, and the GEAR buttons switch it both ways', () => {
    const { game, storage } = makeGame();
    game.update(1 / 120);
    game.press('gear');
    game.press('skis');
    expect(new Store(storage).progress().gear.kit).toBe('skis');
    game.press('snowboard');
    expect(new Store(storage).progress().gear.kit).toBe('snowboard');
  });

  it('switches with left and right on the top row of the GEAR screen', () => {
    const { game, input, store } = makeGame();
    game.update(1 / 120);
    game.press('gear');
    input.push('right');
    game.update(1 / 120);
    expect(store.progress().gear.kit).toBe('skis');
    input.push('left');
    game.update(1 / 120);
    expect(store.progress().gear.kit).toBe('snowboard');
  });

  it('defaults to a snowboard for saves from before skiing, and for anything it does not know', () => {
    const old = memoryStorage();
    old.setItem(
      SAVE_PREFIX + 'progress',
      JSON.stringify({ stats: { runs: 4 }, gear: { board: 'classic', rider: 'classic' } }),
    );
    expect(new Store(old).progress().gear.kit).toBe('snowboard');
    const odd = memoryStorage();
    odd.setItem(SAVE_PREFIX + 'progress', JSON.stringify({ gear: { kit: 'sled' } }));
    expect(new Store(odd).progress().gear.kit).toBe('snowboard');
    expect(new Store(memoryStorage()).progress().gear.kit).toBe('snowboard');
  });

  it('keeps the rules identical: the same inputs play the same run on either', () => {
    const play = (kit: 'snowboard' | 'skis'): string[] => {
      const { game, input, store } = makeGame('g0');
      store.progress().gear.kit = kit;
      game.update(1 / 120);
      game.press('play');
      const log: string[] = [];
      for (let i = 0; i < 120 * 30 && !game.sim.crashed; i++) {
        const r = game.sim.rider;
        input.steerValue = botInput(game.sim).steer;
        input.brakeValue = i % 900 > 840;
        input.flipValue = r.air && Math.floor(r.airT * 10) % 2 === 0 ? 1 : 0;
        if (r.air && r.airT === 0) input.push('trick');
        game.update(1 / 120);
        if (i % 60 === 0) log.push(JSON.stringify([game.sim.rider, game.sim.scoreValue]));
      }
      return log;
    };
    expect(play('skis')).toEqual(play('snowboard'));
  });
});

/** Every pose the snowboarder has: ride, carves, tuck, brake, air, spins, flips. */
function poses(): { name: string; pose: RiderPose }[] {
  const out: { name: string; pose: RiderPose }[] = [];
  const add = (
    name: string,
    hx: number,
    set: (r: ReturnType<typeof createRider>) => void,
    tuck = 0,
  ): void => {
    const r = createRider();
    r.hx = hx;
    r.face = hx > 0.05 ? 1 : -1;
    r.steep = headingAngle(hx) > 70;
    set(r);
    out.push({ name, pose: poseOf(r, 90, 160, tuck) });
  };
  for (const hx of [0, -0.3, -0.6, -0.9, 0.3, 0.6, 0.9]) add(`ride ${hx}`, hx, () => {});
  add('tuck', 0, () => {}, 1);
  add('brake', -0.93, (r) => (r.brake = 1));
  add('air', 0, (r) => (r.air = true), 0.4);
  for (let s = 45; s < 360; s += 45) {
    add(`spin ${s}`, 0, (r) => {
      r.air = true;
      r.spin = s;
      r.spinDir = 1;
    });
  }
  for (let p = 45; p < 360; p += 45) {
    add(`flip ${p}`, 0, (r) => {
      r.air = true;
      r.pitch = p;
    });
  }
  return out;
}

function lit(fb: Framebuffer): number {
  let n = 0;
  for (let y = 0; y < fb.h; y++) for (let x = 0; x < fb.w; x++) if (fb.isOn(x, y)) n++;
  return n;
}

function sameImage(a: Framebuffer, b: Framebuffer): boolean {
  return a.data.every((v, i) => v === b.data[i]);
}

describe('the skier sprite', () => {
  it('has its own drawing in every pose the snowboarder has', () => {
    const missing: string[] = [];
    for (const { name, pose } of poses()) {
      const ski = new Framebuffer(W, H);
      const board = new Framebuffer(W, H);
      drawRider(ski, pose, { style: SKIS, brake: name === 'brake' ? 1 : 0 });
      drawRider(board, pose, { style: BOARD });
      if (lit(ski) < 30 || sameImage(ski, board)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('wipes out with its skis and poles', () => {
    const missing: number[] = [];
    for (const t of [0.1, 0.4, 0.8, 1.5]) {
      const ski = new Framebuffer(W, H);
      const board = new Framebuffer(W, H);
      drawWipeout(ski, 90, 160, t, -1, true);
      drawWipeout(board, 90, 160, t, -1);
      if (lit(ski) < 20 || sameImage(ski, board)) missing.push(t);
    }
    expect(missing).toEqual([]);
  });

  it('stands on two separate skis across the slope', () => {
    const r = createRider();
    r.hx = 0.9;
    r.face = 1;
    r.steep = false;
    const fb = new Framebuffer(W, H);
    drawRider(fb, poseOf(r, 60, 160, 0), { style: SKIS });
    // Past the boots the two ski tips run side by side: two lit runs down the column with a dark gap.
    let split = 0;
    for (let x = 70; x < 78; x++) {
      let runs = 0;
      for (let y = 140; y < 190; y++) if (fb.isOn(x, y) && !fb.isOn(x, y - 1)) runs++;
      if (runs === 2) split++;
    }
    expect(split).toBeGreaterThanOrEqual(4);
  });
});

/** Record a path the way the sim does: a point every 1.5px of travel. */
function trailFrom(path: (y: number) => number, from = 10, to = 310): Trail {
  const t = new Trail(420);
  for (let y = from; y <= to; y += 1.5) t.push(path(y), y);
  return t;
}

function paintSkis(t: Trail): Framebuffer {
  const fb = new Framebuffer(W, H);
  new TrackPainter().draw(fb, t, 0, true, PROBE);
  return fb;
}

/** Separate white runs along each row. */
function runsPerRow(fb: Framebuffer): number[] {
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (fb.get(x, y) === WHITE && fb.get(x - 1, y) !== WHITE) n++;
    rows.push(n);
  }
  return rows;
}

const scurve = (y: number): number => 90 + Math.sin(y / 32) * 34;

describe('the ski track', () => {
  it('is two thin parallel lines with a clean gap on a straight', () => {
    const fb = paintSkis(trailFrom(() => 90.2));
    const bad: number[] = [];
    for (let y = 10; y <= 310; y++) {
      const xs: number[] = [];
      for (let x = 0; x < W; x++) if (fb.get(x, y) === WHITE) xs.push(x);
      const [a, b] = xs;
      if (xs.length !== 2 || a === undefined || b === undefined || b - a < 3) bad.push(y);
    }
    expect(bad).toEqual([]);
    let grey = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fb.get(x, y) === GREY) grey++;
    expect(grey).toBe(0);
  });

  it('keeps both lines through S-curves, with no dotted gaps', () => {
    const runs = runsPerRow(paintSkis(trailFrom((y) => 90 + Math.sin(y / 90) * 14))).slice(12, 308);
    expect(runs.filter((n) => n !== 2)).toEqual([]);
    const tight = runsPerRow(paintSkis(trailFrom(scurve))).slice(12, 308);
    expect(tight.filter((n) => n === 0)).toEqual([]);
  });

  it('stays put once settled, so it does not shimmer as the skier moves on', () => {
    const before = paintSkis(trailFrom(scurve, 10, 200));
    const after = paintSkis(trailFrom(scurve, 10, 240));
    const stray: string[] = [];
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < W; x++) if (before.get(x, y) !== after.get(x, y)) stray.push(`${x},${y}`);
    }
    expect(stray).toEqual([]);
  });

  it('casts its shadow only outside the pair, on the side nearest the sun', () => {
    const fb = paintSkis(trailFrom((y) => 90 + Math.sin(y / 40) * 16));
    const inGap: number[] = [];
    let shaded = 0;
    for (let y = 12; y < 290; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (fb.get(x, y) !== GREY) continue;
        shaded++;
        if (fb.get(x - 1, y) === WHITE) inGap.push(y);
      }
    }
    expect(shaded).toBeGreaterThan(10);
    expect(inGap).toEqual([]);
  });

  it('scrapes one solid band in a skid that takes in both lines', () => {
    const t = new Trail(420);
    for (let y = 10; y <= 200; y += 1.5) t.push(60, y, 1, 0);
    const runs = runsPerRow(paintSkis(t)).slice(20, 190);
    expect(runs.filter((n) => n !== 1)).toEqual([]);
  });

  it('leaves the board track as it was', () => {
    const t = trailFrom(scurve);
    const a = new Framebuffer(W, H);
    const b = new Framebuffer(W, H);
    new TrackPainter().draw(a, t, 0);
    const painter = new TrackPainter();
    painter.draw(b, t, 0, true);
    b.clear();
    painter.draw(b, t, 0, false);
    expect(sameImage(a, b)).toBe(true);
  });
});
