import { drawText, drawTextCentered, textWidth } from './font';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { Rng } from '../core/rng';

/** What the result card shows. */
export interface ResultCardData {
  /** Only for the link, so whoever opens it gets the same course. Never drawn or written out. */
  seed: string;
  daily: boolean;
  score: number;
  dist: number;
  stars: number;
  nearMisses: number;
  tricks: number;
  cause: 'obstacle' | 'bail';
  newBest: boolean;
}

/** The card is drawn at this logical size and scaled up by CARD_SCALE: 1200 x 630, the usual link preview size. */
export const CARD_W = 200;
export const CARD_H = 105;
export const CARD_SCALE = 6;

/** The link someone can open to play the same course. */
export function shareUrl(pageUrl: string, seed: string): string {
  try {
    const u = new URL(pageUrl);
    u.search = '';
    u.hash = '';
    u.searchParams.set('seed', seed);
    return u.toString();
  } catch {
    return `?seed=${seed}`;
  }
}

export function shareText(card: Readonly<ResultCardData>): string {
  return `I scored ${card.score} in Fall Line (${card.dist}m) and wiped out. Beat it on ${card.daily ? "today's daily course" : 'this course'}:`;
}

function peaks(fb: Framebuffer, seed: number): void {
  const rng = new Rng(seed);
  // A ridge line of jagged peaks along the bottom, with a dithered fill.
  const base = CARD_H - 4;
  let x = 0;
  while (x < CARD_W) {
    const w = 10 + Math.floor(rng.next() * 16);
    const peak = 9 + Math.floor(rng.next() * 15);
    for (let i = 0; i < w && x + i < CARD_W; i++) {
      const t = i / w;
      const up = t < 0.5 ? t * 2 : (1 - t) * 2;
      const h = Math.round(4 + (peak - 4) * up);
      const top = base - h;
      fb.put(x + i, top);
      for (let y = top + 1; y <= base; y++) if ((x + i + y) % 4 === 0) fb.put(x + i, y);
    }
    x += w;
  }
}

/** Draw the result card into a CARD_W x CARD_H framebuffer. Pure, so it is easy to test. */
export function renderCard(fb: Framebuffer, card: Readonly<ResultCardData>): void {
  fb.clear(OFF);
  peaks(fb, card.seed.length * 7919 + card.score);
  fb.strokeRect(0, 0, CARD_W, CARD_H, WHITE);
  fb.strokeRect(2, 2, CARD_W - 4, CARD_H - 4, WHITE);
  // clear a plate for the text
  fb.fillRect(8, 8, CARD_W - 16, 70, OFF);
  drawText(fb, 'FALL LINE', 12, 12, WHITE, 2);
  const head = card.cause === 'bail' ? 'BAILED' : 'WIPEOUT';
  drawText(fb, head, CARD_W - 12 - textWidth(head), 12, WHITE);
  if (card.newBest) drawText(fb, 'NEW BEST', CARD_W - 12 - textWidth('NEW BEST'), 20, YELLOW);
  drawText(fb, String(card.score), 12, 24, YELLOW, 5);
  const stats = [
    `${card.dist}M`,
    `STARS ${card.stars}`,
    `CLOSE ${card.nearMisses}`,
    `TRICKS ${card.tricks}`,
  ];
  stats.forEach((s, i) => drawText(fb, s, 12 + (i % 3) * 58, 55 + Math.floor(i / 3) * 9, WHITE));
  if (card.daily) drawTextCentered(fb, 'DAILY COURSE', CARD_W / 2, 73, WHITE);
}
