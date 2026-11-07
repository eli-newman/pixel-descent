import { describe, expect, it } from 'vitest';
import { H, LINE_BONUS, LINE_START_M, PX_PER_M, START_Y, STEP, W } from '../src/core/config';
import { hashSeed } from '../src/core/rng';
import { Framebuffer, YELLOW } from '../src/render/framebuffer';
import { renderUi } from '../src/render/ui';
import { obstacleBox } from '../src/sim/collision';
import { LineTracker, lineMult, type LineEvent } from '../src/sim/lines';
import { createScore } from '../src/sim/score';
import { Sim } from '../src/sim/sim';
import { lineChance, pathHalfWidth, Spawner } from '../src/sim/spawner';
import { maxFlightPx, topSpeed } from '../src/sim/speed';
import type { Ramp } from '../src/sim/types';
import { kickerBotInput } from './helpers/bot';
import { makeGame } from './helpers/fakes';
import type { GameView } from '../src/state/view';

/** The kickers of every line in a batch of ramps, one array per line. */
function linesOf(ramps: readonly Ramp[]): Ramp[][] {
  const out: Ramp[][] = [];
  for (const r of ramps) {
    if (r.line === 0) continue;
    if (r.lineIdx === 0) out.push([r]);
    else out[out.length - 1]?.push(r);
  }
  // A line cut off at the end of the batch is not whole yet.
  const last = out[out.length - 1];
  if (last && last.length < (last[0]?.lineLen ?? 0)) out.pop();
  return out;
}

function kicker(id: number, lineIdx: number, lineLen: number, y: number): Ramp {
  return {
    id,
    kind: 'kicker',
    x: 90,
    y,
    half: 17,
    landEnd: y + 400,
    line: lineLen > 1 ? id - lineIdx : 0,
    lineIdx,
    lineLen,
    used: false,
    seed: 0,
    segs: [],
  };
}

describe('jump lines in the course', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => `line-${i}`);

  it('builds lines of two and three kickers, more of them further down, none near the start', () => {
    let two = 0;
    let three = 0;
    const early: string[] = [];
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      for (const line of linesOf(s.advance(START_Y + 60000).ramps)) {
        if (line.length === 2) two++;
        else if (line.length === 3) three++;
        const first = line[0];
        if (first && (first.y - START_Y) / PX_PER_M < LINE_START_M)
          early.push(`${seed} ${first.id}`);
        if (line.some((r) => r.lineLen !== line.length || r.kind !== 'kicker'))
          early.push(`${seed}: malformed line`);
      }
    }
    expect(early).toEqual([]);
    expect(two).toBeGreaterThan(20);
    expect(three).toBeGreaterThan(10);
    expect(lineChance(LINE_START_M - 1)).toBe(0);
    expect(lineChance(LINE_START_M)).toBeGreaterThan(0);
    expect(lineChance(4000)).toBeGreaterThan(lineChance(500));
  });

  it('keeps a whole line clear across the slope, with room to steer back to the path after it', () => {
    const offenders: string[] = [];
    let lines = 0;
    for (const seed of seeds) {
      const s = new Spawner(hashSeed(seed));
      const batch = s.advance(START_Y + 60000);
      for (const line of linesOf(batch.ramps)) {
        const first = line[0];
        const last = line[line.length - 1];
        if (!first || !last) continue;
        lines++;
        for (const o of batch.obstacles) {
          if (obstacleBox(o) && o.y >= first.y - 14 && o.y <= last.landEnd)
            offenders.push(`${seed} line ${first.id}: ${o.kind} at ${o.x},${o.y}`);
        }
        // Every kicker but the last clears the slope right up to the next lip.
        line.slice(0, -1).forEach((r, k) => {
          if (r.landEnd !== line[k + 1]?.y)
            offenders.push(`${seed} ${r.id}: gap in the clear ground`);
        });
        // A rider who touches down as far as top speed can carry him, on the line's x, steers back
        // (40 px to turn in, then half a pixel sideways per pixel downhill) and is inside the open path,
        // with 10 px of it for his body, by the end of the clear ground.
        const touch =
          Math.round(last.y + maxFlightPx(topSpeed((last.y - START_Y) / PX_PER_M)) + 110) - 110;
        const distM = (last.landEnd - START_Y) / PX_PER_M;
        const off = Math.abs(s.pathCenter(last.landEnd) - first.x);
        if (off > pathHalfWidth(distM) - 10 + 0.5 * Math.max(0, last.landEnd - touch - 40))
          offenders.push(`${seed} line ${first.id}: path ${off} px away at the end`);
        if (Math.abs(first.x - s.pathCenter(first.y)) >= 1)
          offenders.push(`${seed} line ${first.id}: first kicker off the path`);
      }
    }
    expect(offenders).toEqual([]);
    expect(lines).toBeGreaterThan(30);
  });

  it('lets a rider at top speed take every kicker of every line and get back to the path', () => {
    let clean = 0;
    for (const seed of seeds.slice(0, 8)) {
      const sim = new Sim(seed, { forceSpeed: true });
      sim.begin();
      for (let i = 0; i < 400_000 && !sim.crashed && sim.distM < 4000; i++) {
        sim.step(kickerBotInput(sim));
        for (const e of sim.events) if (e.type === 'line' && e.bonus > 0) clean++;
      }
      expect(sim.crashed, seed).toBe(false);
    }
    expect(clean).toBeGreaterThan(10);
  });
});

describe('line scoring', () => {
  it('multiplies the trick points of each clean landing in a line: x1, x1.5, x2', () => {
    expect([0, 1, 2].map(lineMult)).toEqual([1, 1.5, 2]);
    const score = createScore();
    const t = new LineTracker();
    const events: (LineEvent | null)[] = [];
    const extras: number[] = [];
    for (let k = 0; k < 3; k++) {
      t.launch(kicker(10 + k, k, 3, 1000 + 400 * k));
      const { extra, event } = t.land(true, 70, 1, score);
      extras.push(extra);
      events.push(event);
    }
    expect(extras).toEqual([0, 35, 70]);
    expect(events.map((e) => e?.landed)).toEqual([1, 2, 3]);
    // The toast after each landing says what the next kicker pays.
    expect(events.map((e) => e?.mult)).toEqual([1.5, 2, 2]);
    expect(events.map((e) => e?.bonus)).toEqual([0, 0, LINE_BONUS * 3]);
    expect(score.trickPoints).toBe(35 + 70 + LINE_BONUS * 3);
  });

  it('pays the clean line bonus by the speed multiplier, even with no tricks', () => {
    const score = createScore();
    const t = new LineTracker();
    t.launch(kicker(20, 0, 2, 1000));
    t.land(true, 0, 1, score);
    t.launch(kicker(21, 1, 2, 1400));
    const { event } = t.land(true, 0, 2, score);
    expect(event?.bonus).toBe(LINE_BONUS * 2 * 2);
    expect(score.trickPoints).toBe(LINE_BONUS * 2 * 2);
  });

  it('ends a live line on a sloppy landing, and the next kicker pays nothing extra', () => {
    const score = createScore();
    const t = new LineTracker();
    t.launch(kicker(30, 0, 3, 1000));
    t.land(true, 30, 1, score);
    t.launch(kicker(31, 1, 3, 1400));
    const sloppy = t.land(false, 0, 1, score);
    expect(sloppy.event?.broken).toBe('sloppy');
    t.launch(kicker(32, 2, 3, 1800));
    const after = t.land(true, 70, 1, score);
    expect(after.extra).toBe(0);
    expect(after.event).toBeNull();
    expect(score.trickPoints).toBe(0);
  });

  it('says nothing when the first kicker of a line is landed sloppy, as no line was live yet', () => {
    const t = new LineTracker();
    t.launch(kicker(40, 0, 2, 1000));
    expect(t.land(false, 0, 1, createScore()).event).toBeNull();
  });

  it('ends a live line when the rider rides past the next kicker', () => {
    const score = createScore();
    const t = new LineTracker();
    const first = kicker(50, 0, 2, 1000);
    t.launch(first);
    t.land(true, 30, 1, score);
    expect(t.ride(first.landEnd - 10, first.landEnd - 2)).toBeNull();
    expect(t.ride(first.landEnd - 2, first.landEnd + 2)?.broken).toBe('skip');
    // Hitting the last kicker anyway pays no line.
    t.launch(kicker(51, 1, 2, first.landEnd));
    expect(t.land(true, 70, 1, score)).toEqual({ extra: 0, event: null });
  });

  it('ends a line on a bail', () => {
    const score = createScore();
    const t = new LineTracker();
    t.launch(kicker(60, 0, 2, 1000));
    t.land(true, 30, 1, score);
    t.crash();
    t.launch(kicker(61, 1, 2, 1400));
    expect(t.land(true, 70, 1, score).event).toBeNull();
  });

  it('does not count a kicker outside a line, or a line joined halfway', () => {
    const score = createScore();
    const t = new LineTracker();
    t.launch(kicker(70, 0, 1, 1000));
    expect(t.land(true, 70, 1, score).event).toBeNull();
    t.launch(kicker(81, 1, 3, 1400));
    expect(t.land(true, 70, 1, score)).toEqual({ extra: 0, event: null });
  });
});

describe('lines in a real run', () => {
  /** A seed whose course has a line, the line, and a sim at its start. */
  function lineRun(): { sim: Sim; line: Ramp[] } {
    for (let i = 0; ; i++) {
      const seed = `ride-${i}`;
      const line = linesOf(new Spawner(hashSeed(seed)).advance(START_Y + 40000).ramps)[0];
      if (line) return { sim: new Sim(seed), line };
    }
  }

  it('builds the multiplier and pays the bonus when every kicker is landed clean', () => {
    const { sim, line } = lineRun();
    sim.begin();
    const events: LineEvent[] = [];
    const landPts: number[] = [];
    const last = line[line.length - 1];
    for (let i = 0; i < 400_000 && !sim.crashed && last && sim.rider.y < last.landEnd; i++) {
      sim.step(kickerBotInput(sim));
      for (const e of sim.events) {
        if (e.type === 'line') events.push(e);
        if (e.type === 'land' && e.quality === 'clean') landPts.push(e.pts);
      }
    }
    expect(sim.crashed).toBe(false);
    expect(events.map((e) => e.landed)).toEqual(line.map((_, k) => k + 1));
    expect(events.every((e) => e.broken === null)).toBe(true);
    expect(events[events.length - 1]?.bonus).toBeGreaterThanOrEqual(LINE_BONUS * line.length);
  });

  it('breaks the line when the rider skips a kicker in it', () => {
    const { sim, line } = lineRun();
    sim.begin();
    const second = line[1];
    const events: LineEvent[] = [];
    for (let i = 0; i < 400_000 && !sim.crashed && second && sim.rider.y < second.y + 40; i++) {
      // Take the first kicker, then steer wide of the second one.
      const input =
        second && sim.rider.y > second.y - 140 && !sim.rider.air
          ? { steer: sim.rider.x < second.x ? -1 : 1, trick: false }
          : kickerBotInput(sim);
      sim.step(input);
      for (const e of sim.events) if (e.type === 'line') events.push(e);
    }
    expect(events.map((e) => e.broken)).toEqual([null, 'skip']);
  });
});

describe('the line toast on screen', () => {
  it('keeps the combo meter under the second line of a toast, never across it', () => {
    const { game, input } = makeGame('line-toast');
    input.push('start');
    for (let i = 0; i < 6; i++) game.update(STEP);
    game.sim.score.combo = 3;
    game.sim.score.lastNearMissAt = game.sim.runTime;
    const toast = { text: '360 +70', sub: 'LINE X1.5', ttl: 1, max: 1, hot: true };
    // The real game, with only its toast swapped for one that has a second line.
    const view = Object.create(game, { toasts: { value: [toast] } }) as GameView;
    const fb = new Framebuffer(W, H);
    renderUi(fb, view);
    // Each row's longest yellow run. Letters are at most 3 px wide, so any longer run is the combo meter, even
    // where the toast's dark halo cuts through it.
    const run = (y: number): number => {
      let best = 0;
      let cur = 0;
      for (let x = 0; x < W; x++) {
        cur = fb.get(x, y) === YELLOW ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return best;
    };
    const meterRow = Array.from({ length: 120 }, (_, y) => y).find((y) => run(y) > 8) ?? -1;
    // The toast sits at row 52 and its sub line 8 px under it: 5 px of letters and a 1 px halo.
    expect(meterRow).toBeGreaterThan(52 + 8 + 5 + 1);
  });
});
