import { describe, expect, it } from 'vitest';
import { Framebuffer, OFF, YELLOW } from '../src/render/framebuffer';
import {
  CARD_H,
  CARD_W,
  renderCard,
  shareText,
  shareUrl,
  type ResultCardData,
} from '../src/render/share';

const card: ResultCardData = {
  seed: 'k3m9qa',
  daily: false,
  score: 1234,
  dist: 567,
  stars: 8,
  nearMisses: 12,
  tricks: 3,
  cause: 'obstacle',
  newBest: true,
};

describe('share card', () => {
  it('draws something with the yellow score and is deterministic', () => {
    const a = new Framebuffer(CARD_W, CARD_H);
    const b = new Framebuffer(CARD_W, CARD_H);
    renderCard(a, card);
    renderCard(b, card);
    expect(a.data).toEqual(b.data);
    let lit = 0;
    let yellow = 0;
    for (let y = 0; y < CARD_H; y++) {
      for (let x = 0; x < CARD_W; x++) {
        if (a.get(x, y) !== OFF) lit++;
        if (a.get(x, y) === YELLOW) yellow++;
      }
    }
    expect(lit).toBeGreaterThan(500);
    expect(yellow).toBeGreaterThan(50);
  });

  it('differs for a different score', () => {
    const a = new Framebuffer(CARD_W, CARD_H);
    const b = new Framebuffer(CARD_W, CARD_H);
    renderCard(a, card);
    renderCard(b, { ...card, score: 99 });
    expect(a.data).not.toEqual(b.data);
  });

  it('builds a link with the seed and drops other params', () => {
    expect(shareUrl('https://example.com/game/?seed=old&x=1#h', 'k3m9qa')).toBe(
      'https://example.com/game/?seed=k3m9qa',
    );
    expect(shareText(card)).toContain('1234');
    expect(shareText({ ...card, daily: true })).toContain('daily');
  });
});
