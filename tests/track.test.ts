import { describe, expect, it } from 'vitest';
import { H, W } from '../src/core/config';
import { Framebuffer, GREY, SOFT_GREY, WHITE } from '../src/render/framebuffer';
import { TrackPainter } from '../src/render/track';
import { Trail } from '../src/sim/trail';

/** Record a path the way the sim does: a point every 1.5px of travel. */
function trailFrom(path: (y: number) => number, from = 10, to = 310): Trail {
  const t = new Trail(420);
  for (let y = from; y <= to; y += 1.5) t.push(path(y), y);
  return t;
}

function paint(t: Trail, cam = 0): Framebuffer {
  const fb = new Framebuffer(W, H);
  new TrackPainter().draw(fb, t, cam);
  return fb;
}

/** Pixels of a colour in each row. */
function rowCounts(fb: Framebuffer, color: number): number[] {
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (fb.get(x, y) === color) n++;
    rows.push(n);
  }
  return rows;
}

const scurve = (y: number): number => 90 + Math.sin(y / 32) * 34;

describe('the board track', () => {
  it('is an unbroken thin line with no shadow or powder on a straight', () => {
    const fb = paint(trailFrom(() => 90.2));
    const white = rowCounts(fb, WHITE).slice(10, 311);
    expect(white.filter((n) => n < 1 || n > 2)).toEqual([]);
    expect(rowCounts(fb, GREY).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('stays put once settled, so it does not shimmer as the board moves on', () => {
    const before = paint(trailFrom(scurve, 10, 200));
    const after = paint(trailFrom(scurve, 10, 240));
    const stray: string[] = [];
    // Everything more than 40 rows behind the first board position has settled.
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < W; x++) if (before.get(x, y) !== after.get(x, y)) stray.push(`${x},${y}`);
    }
    expect(stray).toEqual([]);
  });

  it('is one clean stroke with no stripes', () => {
    // Gentle enough that no powder appears.
    const fb = paint(trailFrom((y) => 90 + Math.sin(y / 90) * 14));
    const striped: number[] = [];
    for (let y = 12; y < 308; y++) {
      let runs = 0;
      for (let x = 0; x < W; x++) {
        if (fb.get(x, y) === WHITE && fb.get(x - 1, y) !== WHITE) runs++;
      }
      if (runs !== 1) striped.push(y);
    }
    expect(striped).toEqual([]);
  });

  it('starts thin after a landing and thin at the board', () => {
    const white = rowCounts(paint(trailFrom((y) => 90 + Math.sin(y / 32) * 34, 40, 280)), WHITE);
    expect(white[42]).toBeLessThanOrEqual(3);
    expect(white[278]).toBeLessThanOrEqual(3);
  });

  it('has no dotted gaps through S-curves', () => {
    const white = rowCounts(paint(trailFrom(scurve)), WHITE).slice(12, 308);
    expect(white.filter((n) => n === 0)).toEqual([]);
  });

  it('swells in the belly of a turn and pinches where it changes direction', () => {
    // sin(y / 32) bends hardest at its peak (y = 32 * pi / 2 * 3) and not at all where it crosses zero (y = 32 * pi * 2).
    const white = rowCounts(paint(trailFrom(scurve)), WHITE);
    const belly = Math.round(32 * (Math.PI / 2) * 3);
    const pinch = Math.round(32 * Math.PI * 2);
    const near = (y: number): number => Math.max(...white.slice(y - 2, y + 3));
    expect(near(belly)).toBeGreaterThan(near(pinch));
  });

  it('casts a grey shadow only in turns', () => {
    const grey = rowCounts(paint(trailFrom(scurve)), GREY);
    expect(grey.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('falls on the side nearest the sun, like the groove it is, so it matches the tree shadows', () => {
    // Gentle enough that no powder appears.
    const fb = paint(trailFrom((y) => 90 + Math.sin(y / 40) * 16));
    const wrongSide: number[] = [];
    let shaded = 0;
    for (let y = 12; y < 290; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (fb.get(x, y) !== GREY) continue;
        shaded++;
        // The sun is on the left, so grey has the white line to its right and bare snow to its left.
        if (fb.get(x - 1, y) === WHITE) wrongSide.push(y);
      }
    }
    expect(shaded).toBeGreaterThan(10);
    expect(wrongSide).toEqual([]);
  });

  it('breaks over a jump instead of drawing a line across the gap', () => {
    const t = new Trail(420);
    for (let y = 10; y <= 100; y += 1.5) t.push(90, y);
    for (let y = 160; y <= 250; y += 1.5) t.push(90, y);
    const white = rowCounts(paint(t), WHITE);
    expect(white.slice(105, 155).reduce((a, b) => a + b, 0)).toBe(0);
    expect(white[50]).toBeGreaterThan(0);
    expect(white[200]).toBeGreaterThan(0);
  });

  it('draws a skid as one solid band, not two tracks', () => {
    const t = new Trail(420);
    for (let y = 10; y <= 200; y += 1.5) t.push(60, y, 1, 0);
    const fb = paint(t);
    const holes: string[] = [];
    for (let y = 20; y < 190; y++) {
      // Nothing from the tail to the nose is left as bare snow.
      for (let x = 62; x <= 78; x++) if (!fb.isOn(x, y)) holes.push(`${x},${y}`);
    }
    expect(holes).toEqual([]);
  });

  it('shades a skid from its edge nearest the sun, whichever way the board points', () => {
    /** Grey columns on a row, for a board tail at x = 100 with the nose to one side. */
    const greyAt = (nose: number): number[] => {
      const t = new Trail(420);
      for (let y = 10; y <= 200; y += 1.5) t.push(100, y, nose, 0);
      const fb = paint(t);
      const grey: number[] = [];
      for (let x = 70; x <= 130; x++) if (fb.get(x, 100) === SOFT_GREY) grey.push(x);
      return grey;
    };
    // Nose to the left: the nose edge is nearest the sun, at x = 80.
    const left = greyAt(-1);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...left)).toBeLessThan(85);
    // Nose to the right: the tail edge is nearest the sun, at x = 100.
    const right = greyAt(1);
    expect(right.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...right)).toBeLessThan(105);
    expect(Math.min(...right)).toBeGreaterThanOrEqual(98);
  });

  it('has no shadow where the skid has barely opened', () => {
    const t = new Trail(420);
    for (let y = 10; y <= 200; y += 1.5) t.push(100, y, -0.1, 0);
    expect(rowCounts(paint(t), SOFT_GREY).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('leaves no holes in a skid through a turn', () => {
    const t = new Trail(420);
    for (let y = 10; y <= 200; y += 1.5) t.push(50 + Math.sin(y / 30) * 20, y, 0.7, 0.2);
    const fb = paint(t);
    const striped: number[] = [];
    for (let y = 30; y < 180; y++) {
      // Only stretches of 2 or more pixels count: a single pixel off to the side is a grain of powder.
      let runs = 0;
      for (let x = 0; x < W; x++) {
        if (fb.isOn(x, y) && fb.isOn(x + 1, y) && !fb.isOn(x - 1, y)) runs++;
      }
      if (runs !== 1) striped.push(y);
    }
    expect(striped).toEqual([]);
  });

  it('opens a skid out of the line and closes it back up', () => {
    const t = new Trail(420);
    for (let y = 10; y < 100; y += 1.5) t.push(60, y);
    for (let k = 0; k <= 40; k++) t.push(60, 100 + k * 1.5, Math.sin((k / 40) * Math.PI) * 0.7, 0);
    for (let y = 161.5; y <= 250; y += 1.5) t.push(60, y);
    const fb = paint(t);
    // The second track is smooth, so it never leaves a gap between the rows it crosses.
    let last = 60;
    const jumps: number[] = [];
    for (let y = 100; y <= 160; y++) {
      let far = -1;
      for (let x = 0; x < W; x++) if (fb.get(x, y) === WHITE) far = x;
      if (far >= 0 && Math.abs(far - last) > 3) jumps.push(y);
      if (far >= 0) last = far;
    }
    expect(jumps).toEqual([]);
    expect(last).toBeLessThan(66);
  });

  /** Tight enough to throw powder, like real key-press steering. */
  const tight = (y: number): number => 90 + Math.sin(y / 18) * 26;

  it('throws powder from the board, so no grain appears away from the line next to the rider', () => {
    const end = 250;
    const fb = paint(trailFrom(tight, 10, end));
    /** How far a lit pixel strays from the path across some rows. */
    const spread = (from: number, to: number): number => {
      let most = 0;
      for (let y = from; y < to; y++) {
        for (let x = 0; x < W; x++) {
          if (fb.get(x, y) === WHITE) most = Math.max(most, Math.abs(x - tight(y)));
        }
      }
      return most;
    };
    expect(spread(end - 4, end)).toBeLessThanOrEqual(3);
    // Proves there is powder in the test at all: settled grains land well clear of the line.
    expect(spread(60, 210)).toBeGreaterThanOrEqual(5);
  });

  it('moves a grain out gradually instead of popping it into place', () => {
    let before = paint(trailFrom(tight, 10, 150));
    const popped: string[] = [];
    for (let end = 151.5; end <= 240; end += 1.5) {
      const now = paint(trailFrom(tight, 10, end));
      for (let y = 20; y < end; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (now.get(x, y) !== WHITE || before.get(x, y) === WHITE) continue;
          // The line itself may grow. Clear of it, a new pixel can only be a grain sliding from right next to it, or out from under the shadow.
          if (Math.abs(x - tight(y)) <= 5) continue;
          let near = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) near = near || before.isOn(x + dx, y + dy);
          }
          if (!near) popped.push(`${end}:${x},${y}`);
        }
      }
      before = now;
    }
    expect(popped).toEqual([]);
  });

  it('keeps the powder fixed to the snow as the camera moves', () => {
    const t = trailFrom(scurve);
    const a = paint(t, 0);
    const b = paint(t, 20);
    const stray: string[] = [];
    for (let y = 0; y < H - 20; y++) {
      for (let x = 0; x < W; x++) {
        if (a.get(x, y + 20) !== b.get(x, y)) stray.push(`${x},${y}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('draws nothing for an empty trail', () => {
    const fb = paint(new Trail(420));
    expect(rowCounts(fb, WHITE).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
