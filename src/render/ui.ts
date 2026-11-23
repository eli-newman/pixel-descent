import { H, KMH_PER_PXS, W } from '../core/config';
import type { GameView } from '../state/view';
import { menuButtons, OVER_PANEL_TOP, type ButtonId, type UiButton } from '../state/menu';
import {
  ACHIEVEMENTS,
  BOARDS,
  CHALLENGES,
  RIDERS,
  boardIndex,
  challengeDone,
  riderIndex,
  type GearDef,
} from '../state/progress';
import { drawText, drawTextCentered, drawTextHalo, textWidth } from './font';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { hudRect } from './layout';
import { drawRider, type RiderStyle } from './riderSprite';
import type { RiderPose } from '../sim/pose';

const CX = W / 2;

function panel(fb: Framebuffer, y0: number, y1: number): void {
  fb.fillRect(8, y0, W - 16, y1 - y0, OFF);
  fb.strokeRect(8, y0, W - 16, y1 - y0, WHITE);
  fb.strokeRect(10, y0 + 2, W - 20, y1 - y0 - 4, WHITE);
}

function labelOf(g: GameView, id: ButtonId): string {
  const on = (v: boolean): string => (v ? 'ON' : 'OFF');
  switch (id) {
    case 'play':
      return 'PLAY';
    case 'daily':
      return 'DAILY';
    case 'scores':
      return 'SCORES';
    case 'gear':
      return 'GEAR';
    case 'goals':
      return 'GOALS';
    case 'sound':
      return `SOUND ${on(!g.settings.muted)}`;
    case 'back':
      return 'BACK';
    case 'tabTop':
      return 'ALL TIME';
    case 'tabDaily':
      return 'TODAY';
    case 'boardPrev':
    case 'riderPrev':
      return '<';
    case 'boardNext':
    case 'riderNext':
      return '>';
    case 'resume':
      return 'RESUME';
    case 'restart':
      return 'RESTART';
    case 'quit':
      return 'QUIT';
    case 'music':
      return `MUSIC ${on(g.settings.music)}`;
    case 'hud':
      return `BIG HUD ${on(g.settings.bigHud)}`;
    case 'autopause':
      return `AUTO PAUSE ${on(g.settings.autoPause)}`;
    case 'manual':
      return `MANUAL SPIN ${on(g.settings.manualSpin)}`;
    case 'again':
      return 'NEW RUN';
    case 'retry':
      return 'RETRY';
    case 'share':
      return 'SHARE';
    case 'menu':
      return 'MENU';
  }
}

function drawButton(
  fb: Framebuffer,
  g: GameView,
  bt: Readonly<UiButton>,
  focused: boolean,
  selected = false,
): void {
  const y = bt.y;
  const edge = bt.accent || selected ? YELLOW : WHITE;
  fb.fillRect(bt.x, y, bt.w, bt.h, OFF);
  fb.strokeRect(bt.x, y, bt.w, bt.h, edge);
  if (focused) {
    fb.strokeRect(bt.x + 2, y + 2, bt.w - 4, bt.h - 4, YELLOW);
  }
  const label = labelOf(g, bt.id);
  const scale = bt.accent && bt.h >= 26 ? 2 : 1;
  const ty = y + Math.round((bt.h - 5 * scale) / 2);
  drawTextCentered(fb, label, bt.x + bt.w / 2, ty, bt.accent || selected ? YELLOW : WHITE, scale);
}

/** Heads-up display, title, pause and game over screens, all drawn into the low-res buffer. */
export function renderUi(fb: Framebuffer, g: GameView): void {
  switch (g.phase) {
    case 'title':
      drawTitle(fb, g);
      break;
    case 'playing':
    case 'crashed':
      drawHud(fb, g);
      break;
    case 'paused':
      drawHud(fb, g);
      drawPause(fb, g);
      break;
    case 'over':
      drawHud(fb, g);
      drawOver(fb, g);
      break;
  }
}

function drawHud(fb: Framebuffer, g: GameView): void {
  const sim = g.sim;
  const big = g.settings.bigHud;
  const rect = hudRect(big);
  // A solid black block under the numbers: no snow flecks or flakes can touch the text.
  fb.fillRect(0, 0, rect.w, rect.h, OFF);
  fb.fillRect(rect.w, 0, 1, rect.h, OFF);
  const s1 = big ? 3 : 2;
  const s2 = big ? 2 : 1;
  drawText(fb, String(g.sim.scoreValue), 4, 4, YELLOW, s1);
  let y = 4 + 5 * s1 + 3;
  drawText(fb, `${sim.distM}M`, 4, y, WHITE, s2);
  y += 5 * s2 + 3;
  drawText(fb, `BEST ${g.overallBest}`, 4, y, WHITE, s2);

  if (g.phase === 'playing' || g.phase === 'crashed') drawGauges(fb, g);
  if (g.settings.muted) drawTextHalo(fb, 'MUTED', W - 26, H - 8);

  const toast = g.toasts[0];
  if (toast && g.phase !== 'over') {
    const x = Math.round(CX - textWidth(toast.text) / 2);
    const ty = big ? 66 : 52;
    drawTextHalo(fb, toast.text, x, ty, toast.hot ? YELLOW : WHITE);
  }
}

/** Speed read-out, score multiplier and combo meter. */
function drawGauges(fb: Framebuffer, g: GameView): void {
  const sim = g.sim;
  const big = g.settings.bigHud;
  const live = g.phase === 'playing';
  const kmh = Math.round(sim.rider.speed * KMH_PER_PXS);
  const hot = sim.tuck > 0.55;
  const label = `${kmh} KMH`;
  const mult = sim.mult;
  const ms = mult >= 1.95 ? `X${mult.toFixed(1)}` : `X${mult.toFixed(1)}`;
  const sc = big ? 2 : 1;
  const gy = H - 8 * sc - 10;
  // speed bar: fills towards top speed, ticks show cruising speed
  const bw = 52;
  fb.fillRect(3, gy - 1, bw + 2 + (big ? 20 : 0), 8 * sc + 8, OFF);
  drawText(fb, label, 4, gy, hot ? YELLOW : WHITE, sc);
  drawText(fb, ms, 4 + textWidth(label, sc) + 4, gy, hot ? YELLOW : WHITE, sc);
  const by = gy + 5 * sc + 2;
  fb.strokeRect(4, by, bw, 4, WHITE);
  const fill = Math.round((bw - 2) * Math.min(1, sim.rider.speed / 340));
  fb.fillRect(5, by + 1, fill, 2, hot ? YELLOW : WHITE);

  if (!live) return;
  // combo meter: a bar that drains as the combo window runs out
  if (sim.score.combo > 0 && sim.comboLeft > 0) {
    const w = 44;
    const x = Math.round(CX - w / 2);
    const y = big ? 78 : 62;
    const label2 = `X${sim.score.combo}`;
    drawTextHalo(fb, label2, x - textWidth(label2) - 4, y - 1, YELLOW);
    fb.fillRect(x - 1, y - 2, w + 2, 8, OFF);
    fb.strokeRect(x, y - 1, w, 6, YELLOW);
    fb.fillRect(x + 1, y, Math.round((w - 2) * sim.comboLeft), 4, YELLOW);
  }
}

function drawTitle(fb: Framebuffer, g: GameView): void {
  switch (g.screen) {
    case 'main':
      drawMain(fb, g);
      break;
    case 'scores':
      drawScores(fb, g);
      break;
    case 'gear':
      drawGear(fb, g);
      break;
    case 'goals':
      drawGoals(fb, g);
      break;
  }
}

function drawButtons(fb: Framebuffer, g: GameView, selected?: ButtonId): void {
  const buttons = menuButtons(g);
  for (let i = 0; i < buttons.length; i++) {
    const bt = buttons[i];
    if (bt) drawButton(fb, g, bt, g.focusVisible && i === g.focus, bt.id === selected);
  }
}

function drawMain(fb: Framebuffer, g: GameView): void {
  // title plate over the mountains
  fb.fillRect(22, 10, W - 44, 46, OFF);
  fb.strokeRect(22, 10, W - 44, 46, WHITE);
  drawTextCentered(fb, 'POW', CX, 15, WHITE, 3);
  drawTextCentered(fb, 'LINE', CX, 34, WHITE, 3);

  panel(fb, 146, 316);
  const best = g.overallBest;
  drawTextCentered(fb, best > 0 ? `BEST ${best}` : 'NO SCORE YET', CX, 155, WHITE, 2);
  drawButtons(fb, g);
  const daily = g.dailyBest;
  drawTextCentered(fb, daily > 0 ? `TODAY'S BEST ${daily}` : 'NO DAILY RUN YET', CX, 279, WHITE);
  const c = nextChallenge(g);
  if (c) drawTextCentered(fb, `${c.name} ${c.value}/${c.target}`, CX, 288, YELLOW);
  drawTextCentered(
    fb,
    g.touch ? 'HOLD SIDE STEER  SWIPE SIDE SPIN' : 'A D STEER  SPACE TRICK  W S FLIP',
    CX,
    297,
  );
  drawTextCentered(
    fb,
    g.touch ? 'SWIPE UP DOWN FLIP  2 FINGERS BRAKE' : 'A+D BRAKE  P PAUSE  M SOUND  H HUD',
    CX,
    306,
  );
}

/** The unfinished challenge closest to done. */
function nextChallenge(g: GameView): { name: string; value: number; target: number } | null {
  let best: { name: string; value: number; target: number; f: number } | null = null;
  for (const c of CHALLENGES) {
    if (challengeDone(c, g.progress)) continue;
    const v = Math.min(c.target, Math.floor(c.value(g.progress)));
    const f = v / c.target;
    if (!best || f > best.f) best = { name: c.name, value: v, target: c.target, f };
  }
  return best;
}

function drawScores(fb: Framebuffer, g: GameView): void {
  panel(fb, 4, 316);
  drawTextCentered(fb, 'TOP 10', CX, 12, WHITE, 2);
  const daily = g.scoreTab === 'daily';
  drawButtons(fb, g, daily ? 'tabDaily' : 'tabTop');
  drawTextCentered(fb, daily ? "TODAY'S COURSE" : 'YOUR BEST RUNS', CX, 62, YELLOW);
  const list = daily ? g.dailyRuns : g.topRuns;
  for (let i = 0; i < 10; i++) {
    const e = list[i];
    const y = 76 + i * 12;
    drawText(fb, String(i + 1).padStart(2, ' '), 16, y, WHITE);
    if (e) {
      drawText(fb, String(e.score), 36, y, i === 0 ? YELLOW : WHITE);
      drawText(fb, `${e.dist}M`, 86, y, WHITE);
      drawText(fb, e.date.slice(5).replace('-', '/'), 128, y, WHITE);
    } else {
      drawText(fb, '-', 36, y, WHITE);
    }
  }
  drawTextCentered(fb, 'SCORES STAY ON THIS DEVICE', CX, 262);
}

function gearRow(
  fb: Framebuffer,
  g: GameView,
  title: string,
  list: readonly Readonly<GearDef>[],
  idx: number,
  y: number,
): void {
  const def = list[idx];
  if (!def) return;
  drawTextCentered(fb, title, CX, y, WHITE);
  drawTextCentered(fb, def.name, CX, y + 23, YELLOW, 1);
  const unlocked = def.unlocked(g.progress);
  drawTextCentered(fb, unlocked ? 'UNLOCKED' : def.need, CX, y + 36, unlocked ? WHITE : YELLOW);
  void idx;
}

function drawGear(fb: Framebuffer, g: GameView): void {
  panel(fb, 4, 316);
  drawTextCentered(fb, 'GEAR', CX, 12, WHITE, 2);
  const style: RiderStyle = { board: g.boardIdx, rider: g.riderIdx };
  // a rider doing a slow carve, shown big enough to see the details
  const a = (62 * Math.PI) / 180;
  const pose: RiderPose = {
    x: CX + 8,
    y: 86,
    nx: -Math.cos(a),
    ny: Math.sin(a),
    face: -1,
    up: 1,
    ang: 62,
    steep: false,
    tuck: 0,
    pitch: 0,
  };
  drawRider(fb, pose, { style, time: g.animT });
  drawButtons(fb, g);
  const b = g.progress.gear.board;
  const r = g.progress.gear.rider;
  gearRow(fb, g, 'BOARD', BOARDS, boardIndex(b), 150);
  gearRow(fb, g, 'RIDER', RIDERS, riderIndex(r), 200);
  drawTextCentered(fb, 'UNLOCK GEAR BY PLAYING', CX, 270);
}

function drawGoals(fb: Framebuffer, g: GameView): void {
  panel(fb, 4, 316);
  drawTextCentered(fb, 'GOALS', CX, 12, WHITE, 2);
  drawText(fb, 'CHALLENGES', 16, 32, YELLOW);
  CHALLENGES.forEach((c, i) => {
    const y = 44 + i * 20;
    const v = Math.min(c.target, Math.floor(c.value(g.progress)));
    const done = challengeDone(c, g.progress);
    drawText(fb, c.name, 16, y, done ? YELLOW : WHITE);
    drawText(
      fb,
      done ? 'DONE' : `${v}/${c.target}`,
      W - 16 - textWidth(done ? 'DONE' : `${v}/${c.target}`),
      y,
      WHITE,
    );
    fb.strokeRect(16, y + 8, W - 32, 5, WHITE);
    fb.fillRect(17, y + 9, Math.round(((W - 34) * v) / c.target), 3, done ? YELLOW : WHITE);
  });
  drawText(fb, `ACHIEVEMENTS ${g.achievementCount}/${ACHIEVEMENTS.length}`, 16, 134, YELLOW);
  let firstOpen = '';
  ACHIEVEMENTS.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const got = g.progress.achievements[a.id] !== undefined;
    if (!got && firstOpen === '') firstOpen = a.desc;
    const x = 16 + col * 80;
    const y = 148 + row * 14;
    drawText(fb, got ? '*' : '-', x, y, got ? YELLOW : WHITE);
    drawText(fb, a.name, x + 8, y, WHITE);
  });
  drawTextCentered(
    fb,
    firstOpen !== '' ? `NEXT: ${firstOpen}` : 'ALL ACHIEVEMENTS EARNED',
    CX,
    240,
    YELLOW,
  );
  drawButtons(fb, g);
}

function drawPause(fb: Framebuffer, g: GameView): void {
  panel(fb, 50, 228);
  drawTextCentered(fb, 'PAUSED', CX, 56, WHITE, 2);
  drawButtons(fb, g);
  // The spin mode is fixed for a run, so a change made here waits for the next one.
  if (g.settings.manualSpin !== (g.sim.opts.manualSpin === true)) {
    drawTextCentered(fb, 'SPIN MODE STARTS NEXT RUN', CX, 206, YELLOW);
  }
  drawTextCentered(fb, 'P, ESC OR TAP TO RESUME', CX, 216, YELLOW);
}

function drawOver(fb: Framebuffer, g: GameView): void {
  const res = g.result;
  if (!res) return;
  const top = OVER_PANEL_TOP;
  panel(fb, top, top + 164);
  drawTextCentered(fb, g.crashWord, CX, top + 6, WHITE, 2);
  drawTextCentered(fb, String(res.score), CX, top + 21, YELLOW, 3);
  if (res.newBest) {
    drawTextCentered(fb, 'NEW BEST!', CX, top + 41, YELLOW);
  } else {
    drawTextCentered(fb, `BEST ${g.overallBest}`, CX, top + 41, WHITE);
  }
  const sm = res.summary;
  drawTextCentered(fb, `${res.dist}M  STARS ${sm.stars}  CLOSE ${sm.nearMisses}`, CX, top + 51);
  drawTextCentered(fb, `TRICKS ${sm.tricks}  COMBO X${Math.max(1, sm.maxCombo)}`, CX, top + 60);
  const rank = res.rank;
  drawTextCentered(fb, rank ? `RANK ${rank} ALL TIME` : 'NOT IN YOUR TOP 10', CX, top + 71, WHITE);
  // new achievements and gear take turns in one line
  const news: string[] = [
    ...res.achievements.map((a) => `GOAL: ${a.name}`),
    ...res.gear.map((u) => `UNLOCKED: ${u.name}`),
  ];
  if (news.length > 0) {
    const n = news[Math.floor(g.animT / 1.4) % news.length] ?? '';
    drawTextCentered(fb, n, CX, top + 80, YELLOW);
  }
  const buttons = menuButtons(g);
  for (let i = 0; i < buttons.length; i++) {
    const bt = buttons[i];
    if (bt) drawButton(fb, g, bt, g.focusVisible && i === g.focus);
  }
  drawTextCentered(fb, 'SPACE NEW  R RETRY  C SHARE', CX, top + 146);
  const toast = g.toasts[0];
  if (toast) {
    drawTextHalo(fb, toast.text, Math.round(CX - textWidth(toast.text) / 2), top - 10, YELLOW);
  }
}
