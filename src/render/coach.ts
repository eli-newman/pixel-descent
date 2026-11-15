import { H, W } from '../core/config';
import type { GameView } from '../state/view';
import { drawTextHalo, textWidth } from './font';
import { OFF, WHITE, YELLOW, type Framebuffer } from './framebuffer';
import { riderBox } from './layout';

/**
 * The steering lesson's moving picture, under its words: how to hold the screen, acted out. On a touch screen a
 * dashed line splits the screen down the middle and two thumbs at the bottom take turns pressing: the left one (the
 * rider turns left), the right one, then both together (he brakes). Each press sinks the thumb, sends a ring out
 * where it touches and names what it does. On a keyboard the A and D keys do the same.
 */

/** Seconds per press: a short rest with both thumbs up, then the press. Left, right, both, then round again. */
const BEAT = 1.4;
const REST = 0.35;
type Hold = 'none' | 'left' | 'right' | 'both';

/** Which thumbs press at `age` seconds into the lesson, and how far into the press (0 to 1). */
export function coachHold(age: number): { hold: Hold; t: number } {
  const beat = Math.floor(age / BEAT) % 3;
  const into = age % BEAT;
  if (into < REST) return { hold: 'none', t: 0 };
  return {
    hold: beat === 0 ? 'left' : beat === 1 ? 'right' : 'both',
    t: (into - REST) / (BEAT - REST),
  };
}

/**
 * A thumb seen from above, pointing up, drawn at twice the size: `#` its outline, `.` its inside, `n` the nail and
 * the creases of the knuckle. It reaches in from the bottom of the screen, leaning in from its own side the way
 * thumbs hold a phone.
 */
const THUMB = [
  '   #####   ',
  '  #.....#  ',
  ' #.nnnnn.# ',
  ' #n.....n# ',
  '#.n.....n.#',
  '#.n.....n.#',
  '#.n.....n.#',
  '#..nnnnn..#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#..nnnnn..#',
  '#...nnn...#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
];
const THUMB_W = 11;
/** Rows of the thumb (at 1x) per pixel it leans. */
const LEAN = 5;
/** Where the thumbs stand: the middle of each half, their tips this far up, and how far a press sinks them. */
const THUMB_TIP = H - 50;
const SINK = 3;
const THUMB_X = [W / 4, (W * 3) / 4] as const;

/** The thumb thins out into the slope towards the bottom of the frame instead of stopping in a hard line. */
const TAPER = 17;
function kept(i: number, j: number): boolean {
  if (j < TAPER) return true;
  if (j < TAPER + 4) return (i + j) % 2 === 0;
  return i % 2 === 0 && j % 2 === 0;
}

/**
 * One thumb, at twice the size, its tip's top centre at (cx, top), leaning in from the left (`side` -1) or the right
 * (1). Pressed, it is solid white.
 */
function drawThumb(fb: Framebuffer, cx: number, top: number, side: -1 | 1, pressed: boolean): void {
  const x0 = Math.round(cx - THUMB_W);
  const cell = (ch: string): number | null => {
    if (ch === '#') return WHITE;
    if (ch === 'n') return pressed ? OFF : WHITE;
    if (ch === '.') return pressed ? WHITE : OFF;
    return null;
  };
  for (const pass of [0, 1]) {
    THUMB.forEach((row, j) => {
      const lean = Math.floor(j / LEAN) * 2 * side;
      for (let i = 0; i < row.length; i++) {
        const c = cell(row.charAt(i));
        if (c === null || !kept(i, j)) continue;
        const x = x0 + i * 2 + lean;
        const y = top + j * 2;
        if (pass === 0) fb.fillRect(x - 1, y - 1, 4, 4, OFF);
        else fb.fillRect(x, y, 2, 2, c);
      }
    });
  }
}

/** A ring going out from where a thumb touches, thinning out (every other dot, then every third) as it grows. */
function drawRing(fb: Framebuffer, cx: number, cy: number, t: number): void {
  const r = 5 + t * 12;
  const gap = t < 0.5 ? 1 : t < 0.8 ? 2 : 3;
  const n = Math.round(r * 6.3);
  for (let k = 0; k < n; k += gap) {
    const a = (k / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    fb.fillRect(x - 1, y - 1, 3, 3, OFF);
  }
  for (let k = 0; k < n; k += gap) {
    const a = (k / n) * Math.PI * 2;
    fb.put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, YELLOW);
  }
}

/** A key cap at twice the font size, sinking and turning yellow while held. */
function drawKey(fb: Framebuffer, cx: number, top: number, key: string, pressed: boolean): void {
  const size = 22;
  const x = Math.round(cx - size / 2);
  const y = top + (pressed ? 2 : 0);
  const color = pressed ? YELLOW : WHITE;
  fb.strokeRect(x - 1, y - 1, size + 2, size + 2, OFF);
  fb.strokeRect(x + 1, y + 1, size - 2, size - 2, OFF);
  fb.strokeRect(x, y, size, size, color);
  if (!pressed) {
    // the key's lower edge, so it stands up off the screen until pressed
    fb.fillRect(x, y + size, size, 2, color);
    fb.fillRect(x - 1, y + size + 2, size + 2, 1, OFF);
  }
  drawTextHalo(fb, key, Math.round(cx - textWidth(key, 2) / 2), y + 6, color, 2, OFF);
}

/** Chevrons beside the rider pointing the way he turns: `dir` -1 left, 1 right. */
function drawChevrons(fb: Framebuffer, x: number, y: number, dir: -1 | 1, t: number): void {
  const slide = Math.round(t * 4) * dir;
  for (let n = 0; n < 2; n++) {
    const cx = x + slide + n * 6 * dir;
    for (const color of [OFF, YELLOW]) {
      for (let k = -3; k <= 3; k++) {
        const px = cx + (3 - Math.abs(k)) * dir;
        if (color === OFF) fb.fillRect(px - 1, y + k - 1, 3, 3, OFF);
        else fb.put(px, y + k, YELLOW);
      }
    }
  }
}

/** A word in yellow at twice the size, centred on `cx`, with its black edge. */
function word(fb: Framebuffer, text: string, cx: number, y: number): void {
  drawTextHalo(fb, text, Math.round(cx - textWidth(text, 2) / 2), y, YELLOW, 2, OFF);
}

/** The whole picture for the steering lesson, below `top` (the end of its words). */
export function drawCoach(fb: Framebuffer, g: GameView, top: number): void {
  const { hold, t } = coachHold(g.lessonAge);
  const rider = riderBox(g.sim, g.camYi);
  const left = hold === 'left' || hold === 'both';
  const right = hold === 'right' || hold === 'both';

  if (hold === 'left' || hold === 'right') {
    const dir = hold === 'left' ? -1 : 1;
    const x = dir < 0 ? rider.left - 4 : rider.right + 4;
    drawChevrons(fb, x, Math.round((rider.top + rider.bottom) / 2), dir, t);
  }

  const labelY = THUMB_TIP - 30;
  if (g.touch) {
    // the line between the two halves, dashed, from under the rider to the bottom
    const from = Math.max(top, rider.bottom + 6);
    for (let y = from; y < H - 4; y += 6) {
      fb.fillRect(W / 2 - 1, y - 1, 3, 6, OFF);
      fb.fillRect(W / 2, y, 1, 4, WHITE);
    }
    THUMB_X.forEach((cx, i) => {
      const pressed = i === 0 ? left : right;
      if (pressed) drawRing(fb, cx, THUMB_TIP + SINK + 1, t);
      drawThumb(fb, cx, THUMB_TIP + (pressed ? SINK : 0), i === 0 ? -1 : 1, pressed);
    });
  } else {
    drawKey(fb, W / 2 - 18, THUMB_TIP + 6, 'A', left);
    drawKey(fb, W / 2 + 18, THUMB_TIP + 6, 'D', right);
  }

  if (hold === 'both') word(fb, 'BRAKE', W / 2, labelY);
  else if (hold === 'left') word(fb, 'LEFT', g.touch ? THUMB_X[0] : W / 2 - 18, labelY);
  else if (hold === 'right') word(fb, 'RIGHT', g.touch ? THUMB_X[1] : W / 2 + 18, labelY);
}
