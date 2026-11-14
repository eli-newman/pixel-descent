import { describe, expect, it } from 'vitest';
import type { Dare } from '../src/core/dare';
import { BOARDS, RIDERS } from '../src/state/progress';
import { Framebuffer, OFF, WHITE, YELLOW } from '../src/render/framebuffer';
import { CARD_H, CARD_W, dailyDay, renderCard, shareText, shareUrl } from '../src/render/share';

const DARE: Dare = {
  seed: 'k3m9qa',
  score: 1234,
  dist: 567,
  stars: 8,
  tricks: 3,
  end: 'tree',
  skis: false,
  board: 0,
  rider: 0,
};

function draw(d: Dare): Framebuffer {
  const fb = new Framebuffer(CARD_W, CARD_H);
  renderCard(fb, d);
  return fb;
}

/** Lit pixels of a colour inside a box of the card. */
function count(fb: Framebuffer, color: number, x0 = 0, x1 = CARD_W): number {
  let n = 0;
  for (let y = 0; y < CARD_H; y++) for (let x = x0; x < x1; x++) if (fb.get(x, y) === color) n++;
  return n;
}

describe('dare card', () => {
  it('is the same every time, in black, white and the yellow score only', () => {
    const a = draw(DARE);
    expect(a.data).toEqual(draw(DARE).data);
    expect(count(a, YELLOW)).toBeGreaterThan(200);
    const all = count(a, OFF) + count(a, WHITE) + count(a, YELLOW);
    expect(all).toBe(CARD_W * CARD_H);
  });

  it('changes with the score and with what ended the run', () => {
    const base = draw(DARE);
    expect(draw({ ...DARE, score: 99 }).data).not.toEqual(base.data);
    const scenes = new Set(
      (['tree', 'dead', 'rock', 'bush', 'bail'] as const).map((end) =>
        draw({ ...DARE, end }).data.join(),
      ),
    );
    expect(scenes.size).toBe(5);
    // Skis change the fallen rider.
    expect(draw({ ...DARE, skis: true }).data).not.toEqual(base.data);
  });

  it('fits a long score beside the scene', () => {
    // The scene's left edge: nothing yellow may reach it, however long the score.
    for (const score of [7, 1234, 98765, 9999999]) {
      expect(count(draw({ ...DARE, score }), YELLOW, CARD_W - 6 - 92)).toBe(0);
    }
  });

  it('marks a daily course', () => {
    const daily = draw({ ...DARE, seed: 'd20261113' });
    expect(count(daily, YELLOW)).toBeGreaterThan(count(draw(DARE), YELLOW));
  });

  it('puts the day of a daily course where a dare says BEAT', () => {
    /** Rows from the top of the card down to the score. */
    const header = (fb: Framebuffer): number[] => [...fb.data.subarray(0, CARD_W * 4 * 42)];
    const rest = (fb: Framebuffer): number[] => [...fb.data.subarray(CARD_W * 4 * 42)];
    const a = draw({ ...DARE, seed: 'd20261114' });
    const b = draw({ ...DARE, seed: 'd20261115' });
    expect(header(a)).not.toEqual(header(b));
    expect(rest(a)).toEqual(rest(b));
  });

  it("dresses the fallen rider in the player's look", () => {
    const base = draw(DARE);
    const looks = new Set<string>([base.data.join()]);
    for (let board = 1; board <= 3; board++) looks.add(draw({ ...DARE, board }).data.join());
    for (let rider = 1; rider <= 3; rider++) looks.add(draw({ ...DARE, rider }).data.join());
    expect(looks.size).toBe(7);
    // Only the scene changes: the words beside it stay the same.
    const words = (fb: Framebuffer): number[] => {
      const out: number[] = [];
      for (let y = 0; y < CARD_H; y++) {
        for (let x = 0; x < CARD_W - 6 - 92; x++) out.push(fb.get(x, y));
      }
      return out;
    };
    expect(words(draw({ ...DARE, board: 2, rider: 3 }))).toEqual(words(base));
  });

  it('keeps the order of the looks that dare links send by place', () => {
    // Links already sent name a look by its place in these lists: add new ones at the end, never reorder.
    expect(BOARDS.map((b) => b.id)).toEqual(['classic', 'stripe', 'dots', 'twin']);
    expect(RIDERS.map((r) => r.id)).toEqual(['classic', 'beanie', 'scarf', 'ears']);
  });
});

describe('dare link and words', () => {
  it('puts the dare on the site the game is on', () => {
    expect(shareUrl('https://powline.vercel.app/', DARE)).toBe(
      'https://powline.vercel.app/c/k3m9qa-1234-567-8-3-t',
    );
    expect(shareUrl('https://example.com/games/powline/', DARE)).toBe(
      'https://example.com/games/powline/c/k3m9qa-1234-567-8-3-t',
    );
  });

  it('says the score and dares, never the course', () => {
    expect(shareText(DARE)).toBe('1234 on Powline. beat it 👇');
    expect(shareText(DARE)).not.toContain(DARE.seed);
  });

  it("reads a daily run as that day's result, never its seed", () => {
    const daily = { ...DARE, seed: 'd20261114' };
    expect(shareText(daily)).toBe('Powline Daily 14 Nov: 1234, 567m. beat it 👇');
    expect(shareText(daily)).not.toContain('20261114');
    expect(dailyDay('d20260105')).toBe('5 Jan');
    expect(dailyDay('d20261231')).toBe('31 Dec');
    expect(dailyDay('k3m9qa')).toBeNull();
    expect(dailyDay('d20261399')).toBeNull();
    // The link still carries the course, so the dare still opens on it.
    expect(shareUrl('https://powline.vercel.app', daily)).toBe(
      'https://powline.vercel.app/c/d20261114-1234-567-8-3-t',
    );
  });
});
