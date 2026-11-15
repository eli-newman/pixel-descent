import { darePath, type Dare, type DareEnd } from '../core/dare';
import { isDailySeed } from '../core/rng';
import type { ObstacleKind } from '../sim/types';
import { drawText, textWidth } from './font';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { drawDizzyBirds, drawWipeout, wipeoutHead } from './riderSprite';
import { getSprite } from './sprites';

/**
 * The dare card: what a share link shows as its preview, and the image the share sheet sends along. It is a dare,
 * so the score to beat is the biggest thing on it, and beside it the run's wipeout is staged with the game's own
 * sprites: whatever ended it, the rider down beside it and the birds over his head.
 */

/** The card is drawn at this logical size and scaled up by CARD_SCALE: 1200 x 630, the usual link preview size. */
export const CARD_W = 200;
export const CARD_H = 105;
export const CARD_SCALE = 6;

/** The wipeout scene: drawn this size, then copied onto the card at twice the scale. */
const SCENE_W = 46;
const SCENE_H = 44;
const SCENE_X = CARD_W - 6 - SCENE_W * 2;
const SCENE_Y = 9;
/** Width the score may take, left of the scene. */
const SCORE_W = SCENE_X - 18;

/** The link that opens the dare, on the site at `origin` (for example `https://powline.vercel.app`). */
export function shareUrl(origin: string, c: Readonly<Dare>): string {
  return `${origin.replace(/\/+$/, '')}${darePath(c)}`;
}

/** The words that go with the link. The preview card carries the rest. */
export function shareText(c: Readonly<Dare>): string {
  return isDailySeed(c.seed)
    ? `${c.score} on today's Powline. beat it 👇`
    : `${c.score} on Powline. beat it 👇`;
}

/** The line under the stats: how the run ended. */
export function endLine(end: DareEnd): string {
  switch (end) {
    case 'tree':
      return 'WIPED OUT ON A TREE';
    case 'dead':
      return 'WIPED OUT ON A DEAD TREE';
    case 'rock':
      return 'WIPED OUT ON A ROCK';
    case 'bush':
      return 'WIPED OUT IN A BUSH';
    case 'bail':
      return 'BAILED A LANDING';
  }
}

/** What stands beside the fallen rider, and its size: none after a bail. */
function hitThing(end: DareEnd): { kind: ObstacleKind; size: number } | null {
  switch (end) {
    case 'tree':
      return { kind: 'tree', size: 20 };
    case 'dead':
      return { kind: 'dead', size: 18 };
    case 'rock':
      return { kind: 'rock', size: 13 };
    case 'bush':
      return { kind: 'bush', size: 1 };
    case 'bail':
      return null;
  }
}

/** The wipeout, at 1x: the rider's track coming down into it, the thing he hit, him lying still, the birds. */
function drawScene(fb: Framebuffer, c: Readonly<Dare>): void {
  fb.clear(OFF);
  // He lies across the lower middle, head to the left, the thing he hit on the right.
  const rx = 20;
  const ry = 38;
  const thing = hitThing(c.end);
  if (thing) {
    const sp = getSprite(thing.kind, thing.size, 1);
    const ox = SCENE_W - 7;
    const oy = ry - 2;
    for (let i = 0; i < sp.shadow.length; i += 2) {
      const dx = sp.shadow[i] ?? 0;
      const dy = sp.shadow[i + 1] ?? 0;
      if ((ox + dx + oy + dy) % 2 === 0) fb.put(ox + dx, oy + dy, WHITE);
    }
    for (let i = 0; i < sp.pts.length; i += 2) {
      fb.put(ox + (sp.pts[i] ?? 0), oy + (sp.pts[i + 1] ?? 0), WHITE);
    }
  }
  // The track he rode in on: down from the top and swinging in to where he went down, broken off before him.
  const end = ry - 15;
  for (let y = 0; y <= end; y++) {
    fb.put(Math.round(rx + 6 - 4 * Math.sin((y / end) * Math.PI)), y, WHITE);
  }
  // Long after the tumble, so he lies still; the birds at the moment they are spread evenly round his head.
  drawWipeout(fb, rx, ry, 4, -1, c.skis);
  drawDizzyBirds(fb, wipeoutHead(rx, ry, -1), Math.PI / 2 / 3.2);
}

/** Draw the dare card into a CARD_W x CARD_H framebuffer. Pure, so it is easy to test. */
export function renderCard(fb: Framebuffer, c: Readonly<Dare>): void {
  fb.clear(OFF);
  fb.strokeRect(0, 0, CARD_W, CARD_H, WHITE);
  fb.strokeRect(2, 2, CARD_W - 4, CARD_H - 4, WHITE);

  const x = 12;
  drawText(fb, 'POWLINE', x, 12, WHITE, 2);
  if (isDailySeed(c.seed)) {
    drawText(fb, 'DAILY', x + textWidth('POWLINE', 2) + 6, 17, YELLOW);
  }
  drawText(fb, 'BEAT', x, 30, WHITE, 2);
  // As big as fits beside the scene: five times the font for four digits, smaller for a longer score.
  const score = String(c.score);
  const scale = Math.max(2, Math.min(5, Math.floor(SCORE_W / Math.max(1, textWidth(score)))));
  drawText(fb, score, x, 44, YELLOW, scale);
  const stats = `${c.dist}M  *${c.stars}  ${c.tricks} TRICK${c.tricks === 1 ? '' : 'S'}`;
  drawText(fb, stats, x, 76, WHITE);
  drawText(fb, endLine(c.end), x, 87, WHITE);

  const scene = new Framebuffer(SCENE_W, SCENE_H);
  drawScene(scene, c);
  fb.blitScaled(scene, SCENE_X, SCENE_Y, 2);
}
