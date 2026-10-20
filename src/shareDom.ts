import {
  CARD_H,
  CARD_SCALE,
  CARD_W,
  renderCard,
  shareText,
  shareUrl,
  type ResultCardData,
} from './share';
import { Framebuffer } from './render/framebuffer';

/** Draw the card to an offscreen canvas at full size (nearest-neighbour, so the pixels stay crisp). */
export function cardCanvas(card: ResultCardData): HTMLCanvasElement {
  const fb = new Framebuffer(CARD_W, CARD_H);
  renderCard(fb, card);
  const small = document.createElement('canvas');
  small.width = CARD_W;
  small.height = CARD_H;
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('2D canvas is not supported');
  sctx.putImageData(new ImageData(fb.data, CARD_W, CARD_H), 0, 0);
  const big = document.createElement('canvas');
  big.width = CARD_W * CARD_SCALE;
  big.height = CARD_H * CARD_SCALE;
  const bctx = big.getContext('2d');
  if (!bctx) throw new Error('2D canvas is not supported');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Share a result: the Web Share API with the card image when the browser supports sharing files,
 * otherwise the link alone; with no Web Share at all the link is copied and the image downloaded.
 * Resolves to a short message for the player.
 */
export async function shareResult(card: ResultCardData, pageUrl: string): Promise<string> {
  const url = shareUrl(pageUrl, card.seed);
  const text = shareText(card);
  const blob = await toBlob(cardCanvas(card));
  const file = blob
    ? new File([blob], `pixel-descent-${card.seed}.png`, { type: 'image/png' })
    : null;
  if (typeof navigator.share === 'function') {
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, url, title: 'Pixel Descent' });
      } else {
        await navigator.share({ text, url, title: 'Pixel Descent' });
      }
      return 'SHARED';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'SHARE CANCELLED';
      // fall through to copy and download
    }
  }
  const copied = await copy(`${text} ${url}`);
  if (blob) download(blob, `pixel-descent-${card.seed}.png`);
  return copied ? 'LINK COPIED, IMAGE SAVED' : 'IMAGE SAVED';
}
