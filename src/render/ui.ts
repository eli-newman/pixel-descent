import { H, W } from '../config';
import type { Game } from '../game';
import { drawTextCentered, drawTextHalo, textWidth } from './font';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';

const CX = W / 2;

function panel(fb: Framebuffer, y0: number, y1: number): void {
  fb.fillRect(10, y0, W - 20, y1 - y0, OFF);
  fb.strokeRect(10, y0, W - 20, y1 - y0, WHITE);
  fb.strokeRect(12, y0 + 2, W - 24, y1 - y0 - 4, WHITE);
}

/** Yellow text that blinks gently (steady when reduced motion is preferred). */
function blink(g: Game): boolean {
  return g.reduced || Math.floor(g.animT * 2.2) % 2 === 0;
}

/** Heads-up display, title, pause and game over screens, all drawn into the low-res buffer. */
export function renderUi(fb: Framebuffer, g: Game, soundOn: boolean): void {
  switch (g.phase) {
    case 'title':
      drawTitle(fb, g, soundOn);
      break;
    case 'playing':
    case 'crashed':
      drawHud(fb, g, soundOn);
      break;
    case 'paused':
      drawHud(fb, g, soundOn);
      drawPause(fb, g, soundOn);
      break;
    case 'over':
      drawHud(fb, g, soundOn);
      drawOver(fb, g);
      break;
  }
}

function drawHud(fb: Framebuffer, g: Game, soundOn: boolean): void {
  drawTextHalo(fb, String(g.scoreValue), 4, 4, YELLOW, 2);
  drawTextHalo(fb, `${g.distM}M`, 4, 17);
  drawTextHalo(fb, `BEST ${g.best}`, 4, 25);
  if (soundOn) drawTextHalo(fb, 'SND', 4, H - 8);
  const toast = g.toasts[0];
  if (toast && g.phase === 'playing') {
    const x = Math.round(CX - textWidth(toast.text) / 2);
    drawTextHalo(fb, toast.text, x, 50, YELLOW);
  }
}

function drawTitle(fb: Framebuffer, g: Game, soundOn: boolean): void {
  panel(fb, 166, 298);
  drawTextCentered(fb, 'PIXEL', CX, 175, WHITE, 3);
  drawTextCentered(fb, 'DESCENT', CX, 193, WHITE, 3);
  if (blink(g)) drawTextCentered(fb, 'PRESS SPACE OR TAP', CX, 218, YELLOW);
  drawTextCentered(fb, 'A D OR ARROWS TO CARVE', CX, 233);
  drawTextCentered(fb, 'TOUCH: HOLD A SIDE OR DRAG', CX, 241);
  drawTextCentered(fb, 'TREES AND ROCKS WIPE YOU OUT', CX, 253);
  drawTextCentered(fb, 'STARS, FLAGS, CLOSE CALLS SCORE', CX, 261);
  drawTextCentered(fb, `P PAUSE   M SOUND ${soundOn ? 'ON' : 'OFF'}`, CX, 273);
  drawTextCentered(fb, `BEST ${g.best}   SEED ${g.seed}`, CX, 285);
}

function drawPause(fb: Framebuffer, g: Game, soundOn: boolean): void {
  panel(fb, 150, 240);
  drawTextCentered(fb, 'PAUSED', CX, 162, WHITE, 2);
  drawTextCentered(fb, 'P, ESC OR TAP TO RESUME', CX, 184, YELLOW);
  drawTextCentered(fb, 'R RESTART SAME SEED', CX, 198);
  drawTextCentered(fb, `M SOUND ${soundOn ? 'ON' : 'OFF'}`, CX, 208);
  drawTextCentered(fb, `SEED ${g.seed}`, CX, 222);
}

function drawOver(fb: Framebuffer, g: Game): void {
  panel(fb, 150, 296);
  drawTextCentered(fb, 'WIPEOUT', CX, 162, WHITE, 2);
  drawTextCentered(fb, `DISTANCE ${g.distM}M`, CX, 184);
  drawTextCentered(
    fb,
    `STARS ${g.score.stars}  CLOSE ${g.score.nearMisses}  FLAGS ${g.score.gates}`,
    CX,
    193,
  );
  drawTextCentered(fb, 'SCORE', CX, 207);
  drawTextCentered(fb, String(g.scoreValue), CX, 215, YELLOW, 2);
  if (g.newBest) {
    if (blink(g)) drawTextCentered(fb, 'NEW BEST!', CX, 234, YELLOW);
  } else {
    drawTextCentered(fb, `BEST ${g.best}`, CX, 234);
  }
  drawTextCentered(fb, `SEED ${g.seed}`, CX, 246);
  if (blink(g)) drawTextCentered(fb, 'SPACE OR TAP: NEW RUN', CX, 262, YELLOW);
  drawTextCentered(fb, 'R: SAME SEED   M: SOUND', CX, 274);
}
