import type { Dare } from '../core/dare';
import { Framebuffer } from '../render/framebuffer';
import { CARD_H, CARD_SCALE, CARD_W, renderCard } from '../render/share';
import { encodePng } from './png';

/** The dare card as a 1200 x 630 PNG: the game's own card, every pixel a CARD_SCALE square, for link previews. */
export function cardPng(dare: Readonly<Dare>): Uint8Array {
  const fb = new Framebuffer(CARD_W, CARD_H);
  renderCard(fb, dare);
  const w = CARD_W * CARD_SCALE;
  const h = CARD_H * CARD_SCALE;
  const big = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / CARD_SCALE);
    for (let x = 0; x < w; x++) {
      const s = (sy * CARD_W + Math.floor(x / CARD_SCALE)) * 4;
      big.set(fb.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return encodePng(w, h, big);
}
