import { describe, expect, it } from 'vitest';
import type { Dare } from '../src/core/dare';
import { Framebuffer, OFF, WHITE, YELLOW } from '../src/render/framebuffer';
import { CARD_H, CARD_W, renderCard, shareText, shareUrl } from '../src/render/share';

const DARE: Dare = {
  seed: 'k3m9qa',
  score: 1234,
  dist: 567,
  stars: 8,
  tricks: 3,
  end: 'tree',
  skis: false,
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
    expect(shareText({ ...DARE, seed: 'd20261113' })).toBe("1234 on today's Powline. beat it 👇");
    expect(shareText(DARE)).not.toContain(DARE.seed);
  });
});
