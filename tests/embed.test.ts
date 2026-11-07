import { describe, expect, it } from 'vitest';
import { BOARD_LEN } from '../src/core/config';
import {
  clearSurface,
  createSurface,
  drawLanding,
  drawRider,
  drawSpray,
  EMBED_BOARD_LEN,
  EMBED_PALETTE,
  EmbedTrack,
  LANDING_DURATION,
  SPRAY_DURATION,
  type EmbedPose,
  type Surface,
} from '../src/embed/index';
import { PALETTE } from '../src/render/framebuffer';

const W = 180;
const H = 400;

function pose(over: Partial<EmbedPose> = {}): EmbedPose {
  return { x: 90, y: 120, heading: 0, edge: 0, air: 0, pitch: 0, spin: 0, crouch: 0, ...over };
}

function alphaCount(s: Surface): number {
  let n = 0;
  for (let i = 3; i < s.data.length; i += 4) if (s.data[i] !== 0) n++;
  return n;
}

/** Every pixel is either untouched (all four bytes 0) or fully opaque. */
function strays(s: Surface): number[] {
  const bad: number[] = [];
  for (let i = 0; i < s.data.length; i += 4) {
    const a = s.data[i + 3];
    const rgb = (s.data[i] ?? 0) + (s.data[i + 1] ?? 0) + (s.data[i + 2] ?? 0);
    if ((a === 0 && rgb !== 0) || (a !== 0 && a !== 255)) bad.push(i / 4);
  }
  return bad;
}

/** Rows with any white pixel, as [min, max]. */
function whiteRows(s: Surface): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const i = (y * s.width + x) * 4;
      if (s.data[i] === 255 && s.data[i + 1] === 255 && s.data[i + 2] === 255) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  }
  return [lo, hi];
}

/** S-turns down the page, then a jump from y 230 to 290, then straight on. */
function samplePath(track: EmbedTrack, until = H - 20): void {
  for (let y = 20; y <= until; y += 2) {
    const air = y > 230 && y < 290 ? 20 : 0;
    const x = 90 + Math.sin(y / 30) * 30;
    const heading = Math.atan2(Math.cos(y / 30), 1);
    track.add({ x, y, heading, edge: Math.sign(heading), air });
  }
}

function render(draw: (s: Surface) => void): Surface {
  const s = createSurface(W, H);
  draw(s);
  return s;
}

describe('the embed', () => {
  it('starts and clears to fully transparent', () => {
    const s = createSurface(W, H);
    expect(s.data.length).toBe(W * H * 4);
    expect(alphaCount(s)).toBe(0);
    drawRider(s, pose());
    expect(alphaCount(s)).toBeGreaterThan(0);
    clearSurface(s);
    expect(alphaCount(s)).toBe(0);
  });

  it('leaves untouched pixels at alpha 0 and draws only opaque pixels', () => {
    const s = render((s) => {
      const track = new EmbedTrack();
      samplePath(track);
      track.draw(s);
      drawSpray(s, { x: 90, y: 150 }, 0.6, 1, 0.3, 4);
      drawLanding(s, { x: 90, y: 300 }, 0.2, 9);
      drawRider(s, pose({ air: 12, pitch: 1, spin: 2 }));
    });
    expect(strays(s)).toEqual([]);
    expect(alphaCount(s)).toBeGreaterThan(200);
    expect(alphaCount(s)).toBeLessThan(W * H * 0.1);
  });

  it('gives identical bytes for the same inputs', () => {
    const scene = (s: Surface): void => {
      const track = new EmbedTrack();
      samplePath(track);
      track.draw(s);
      drawSpray(s, { x: 80, y: 140 }, -0.4, -0.8, 0.41, 11);
      drawLanding(s, { x: 95, y: 292 }, 0.13, 2);
      drawRider(s, pose({ x: 95.4, y: 260.7, air: 18, pitch: 2.2, spin: 4.1, crouch: 0.3 }));
    };
    expect(render(scene).data).toEqual(render(scene).data);
  });

  it('draws the same track whether it is replayed or reused after a reset', () => {
    const track = new EmbedTrack();
    samplePath(track, 200);
    const a = render((s) => track.draw(s));
    track.reset();
    samplePath(track, 200);
    const b = render((s) => track.draw(s));
    const fresh = new EmbedTrack();
    samplePath(fresh, 200);
    const c = render((s) => fresh.draw(s));
    expect(b.data).toEqual(a.data);
    expect(c.data).toEqual(a.data);
  });

  it('lifts the rider off its shadow as air grows', () => {
    const clear: number[] = [];
    for (const air of [0, 8, 16, 24, 32]) {
      const s = render((s) => drawRider(s, pose({ air })));
      const [top, bottom] = whiteRows(s);
      // The rider is lifted by exactly `air`, and the shadow stays on the snow at y 120.
      expect(top).toBe(whiteRows(render((s) => drawRider(s, pose())))[0] - air);
      if (air > 0) expect(bottom).toBeGreaterThanOrEqual(120);
      // Empty rows between the rider's lifted board and its shadow.
      let empty = 0;
      for (let y = top; y < 119; y++) {
        let any = false;
        for (let x = 0; x < W; x++) any ||= (s.data[(y * W + x) * 4 + 3] ?? 0) > 0;
        if (!any) empty++;
      }
      clear.push(empty);
    }
    expect(clear[0]).toBe(0);
    expect(clear[2]).toBeGreaterThan(0);
    expect(clear[3]).toBeGreaterThan(clear[2] ?? 0);
    expect(clear[4]).toBeGreaterThan(clear[3] ?? 0);
  });

  it('draws no shadow on the ground', () => {
    const grounded = render((s) => drawRider(s, pose()));
    const [, bottom] = whiteRows(grounded);
    // A grounded board pointing down the page ends at its nose, half a board below the centre.
    expect(bottom).toBeLessThanOrEqual(120 + Math.ceil(BOARD_LEN / 2) + 1);
  });

  it('breaks the track over a jump', () => {
    const track = new EmbedTrack();
    samplePath(track);
    const s = render((s) => track.draw(s));
    const rows = new Array<number>(H).fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if ((s.data[(y * W + x) * 4 + 3] ?? 0) > 0) rows[y]++;
    }
    // The track runs from the board's tail, half a board above its centre.
    const half = BOARD_LEN / 2;
    expect(rows.slice(40, 220 - half).filter((n) => n === 0)).toEqual([]);
    expect(rows.slice(236 - half, 286 - half).some((n) => n > 0)).toBe(false);
    expect(rows.slice(300 - half, 370 - half).filter((n) => n === 0)).toEqual([]);
  });

  it('looks the same however finely the path is sampled', () => {
    const coarse = new EmbedTrack();
    const fine = new EmbedTrack();
    for (let y = 20; y <= 300; y += 6) coarse.add({ x: 90, y, heading: 0, edge: 0, air: 0 });
    for (let y = 20; y <= 300; y += 0.5) fine.add({ x: 90, y, heading: 0, edge: 0, air: 0 });
    const a = render((s) => coarse.draw(s));
    const b = render((s) => fine.draw(s));
    // Only rounding at half pixels may differ.
    let differ = 0;
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) differ++;
    expect(alphaCount(a)).toBeGreaterThan(400);
    expect(differ).toBeLessThan(alphaCount(a) * 0.05);
  });

  it('draws a slide as a wide band', () => {
    const plain = new EmbedTrack();
    const slid = new EmbedTrack();
    for (let y = 20; y <= 200; y += 2) {
      plain.add({ x: 90, y, heading: 1.2, edge: -1, air: 0 });
      slid.add({ x: 90, y, heading: 1.2, edge: -1, air: 0, slide: y > 80 && y < 160 ? 1 : 0 });
    }
    expect(alphaCount(render((s) => slid.draw(s)))).toBeGreaterThan(
      3 * alphaCount(render((s) => plain.draw(s))),
    );
  });

  it('builds spray and a landing puff, then draws nothing once they finish', () => {
    const spray = (age: number): number =>
      alphaCount(render((s) => drawSpray(s, { x: 90, y: 200 }, 0.5, 1, age, 3)));
    const landing = (age: number): number =>
      alphaCount(render((s) => drawLanding(s, { x: 90, y: 200 }, age, 3)));
    expect(spray(-0.1)).toBe(0);
    expect(spray(0.3)).toBeGreaterThan(10);
    expect(spray(SPRAY_DURATION)).toBe(0);
    expect(spray(SPRAY_DURATION + 5)).toBe(0);
    expect(landing(0.15)).toBeGreaterThan(5);
    expect(landing(LANDING_DURATION)).toBe(0);
    expect(SPRAY_DURATION).toBeLessThan(3);
  });

  it('throws spray to the outside: toeside toward +x, heelside toward -x, heading down the page', () => {
    const side = (edge: number): number => {
      const s = render((s) => drawSpray(s, { x: 90, y: 200 }, 0, edge, 0.5, 1));
      let sum = 0;
      let n = 0;
      for (let i = 0; i < W * H; i++) {
        if ((s.data[i * 4 + 3] ?? 0) > 0) {
          sum += i % W;
          n++;
        }
      }
      return sum / n - 90;
    };
    expect(side(1)).toBeGreaterThan(3);
    expect(side(-1)).toBeLessThan(-3);
  });

  it('draws any heading, flip and spin without throwing, and ignores bad numbers', () => {
    const s = createSurface(W, H);
    const offenders: string[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 4 - Math.PI * 2;
      for (const over of [
        { heading: a },
        { pitch: a, air: 10 },
        { spin: a, air: 10 },
        { heading: a, pitch: -a, spin: a * 2, crouch: (i % 5) / 4, edge: (i % 3) - 1 },
      ]) {
        clearSurface(s);
        try {
          drawRider(s, pose(over), { board: i % 4, rider: i % 5, time: i });
        } catch (e) {
          offenders.push(`${JSON.stringify(over)}: ${String(e)}`);
        }
        if (alphaCount(s) === 0) offenders.push(`${JSON.stringify(over)}: drew nothing`);
      }
    }
    expect(offenders).toEqual([]);
    clearSurface(s);
    drawRider(s, pose({ x: NaN }));
    drawRider(s, pose({ x: -500, y: 9000 }));
    drawSpray(s, { x: 90, y: Infinity }, 0, 1, 0.2);
    expect(alphaCount(s)).toBe(0);
  });

  it('exports the game palette and board length', () => {
    expect(EMBED_PALETTE).toEqual({
      white: '#ffffff',
      yellow: '#f5d742',
      grey: '#6e6e6e',
      softGrey: '#a8a8a8',
    });
    expect(PALETTE.yellow).toEqual([0xf5, 0xd7, 0x42]);
    expect(EMBED_BOARD_LEN).toBe(BOARD_LEN);
  });

  it('rejects surfaces it cannot draw into', () => {
    expect(() => createSurface(0, 10)).toThrow(RangeError);
    expect(() => createSurface(10.5, 10)).toThrow(RangeError);
    const bad = { width: 10, height: 10, data: new Uint8ClampedArray(12) };
    expect(() => drawRider(bad, pose())).toThrow(RangeError);
  });
});
