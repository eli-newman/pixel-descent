import { H, KMH_PER_PXS, W } from '../config';
import { PANEL_SLIDE, type Game } from '../game';
import { menuButtons, OVER_PANEL_TOP, type ButtonId, type UiButton } from '../menu';
import {
  ACHIEVEMENTS,
  BOARDS,
  CHALLENGES,
  RIDERS,
  boardIndex,
  challengeDone,
  riderIndex,
  type GearDef,
} from '../progress';
import { drawText, drawTextCentered, drawTextHalo, textWidth } from './font';
import { Framebuffer, OFF, WHITE, YELLOW } from './framebuffer';
import { hudRect } from './layout';
import { drawRider, type RiderStyle } from './riderSprite';
import type { RiderPose } from '../rider';

const CX = W / 2;

function panel(fb: Framebuffer, y0: number, y1: number): void {
  fb.fillRect(8, y0, W - 16, y1 - y0, OFF);
  fb.strokeRect(8, y0, W - 16, y1 - y0, WHITE);
  fb.strokeRect(10, y0 + 2, W - 20, y1 - y0 - 4, WHITE);
}

/** Yellow text that blinks gently (steady when reduced motion is preferred). */
function blink(g: Game): boolean {
  return g.reduced || Math.floor(g.animT * 2.2) % 2 === 0;
}

function labelOf(g: Game, id: ButtonId): string {
  const on = (v: boolean): string => (v ? 'ON' : 'OFF');
  switch (id) {
    case 'play':
      return 'PLAY';
    case 'daily':
      return 'DAILY';
    case 'newseed':
      return 'NEW SEED';
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
    case 'tabSeed':
      return 'THIS SEED';
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
    case 'again':
      return 'NEW RUN';
    case 'retry':
      return 'RETRY SEED';
    case 'share':
      return 'SHARE';
    case 'menu':
      return 'MENU';
  }
}

function drawButton(
  fb: Framebuffer,
  g: Game,
  bt: UiButton,
  focused: boolean,
  dy = 0,
  selected = false,
): void {
  const y = bt.y + dy;
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
export function renderUi(fb: Framebuffer, g: Game): void {
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

function drawHud(fb: Framebuffer, g: Game): void {
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
  drawText(fb, `BEST ${g.seedBest}`, 4, y, WHITE, s2);

  if (g.phase === 'playing' || g.phase === 'crashed') drawGauges(fb, g);
  if (g.settings.muted) drawTextHalo(fb, 'MUTED', W - 26, H - 8);

  const toast = g.toasts[0];
  if (toast && g.phase !== 'over') {
    const x = Math.round(CX - textWidth(toast.text) / 2);
    const ty = big ? 66 : 52;
    drawTextHalo(fb, toast.text, x, ty, toast.hot ? YELLOW : WHITE);
  }
}

/** Speed read-out, score multiplier, combo meter and the avalanche warning. */
function drawGauges(fb: Framebuffer, g: Game): void {
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
  // avalanche gauge on the right edge: how close the wall is
  if (sim.danger > 0.15) {
    const x = W - 7;
    const top = 44;
    const h = 60;
    fb.fillRect(x - 2, top - 2, 7, h + 4, OFF);
    fb.strokeRect(x - 1, top - 1, 5, h + 2, WHITE);
    const f = Math.round(h * sim.danger);
    if (sim.danger < 0.7 || g.reduced || Math.floor(g.animT * 6) % 2 === 0) {
      fb.fillRect(x, top, 3, f, sim.danger > 0.6 ? YELLOW : WHITE);
    }
    drawTextHalo(fb, '!', x - 1, top + h + 4, YELLOW);
  }
}

function drawTitle(fb: Framebuffer, g: Game): void {
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

function drawButtons(fb: Framebuffer, g: Game, selected?: ButtonId): void {
  const buttons = menuButtons(g);
  for (let i = 0; i < buttons.length; i++) {
    const bt = buttons[i];
    if (bt) drawButton(fb, g, bt, g.focusVisible && i === g.focus, 0, bt.id === selected);
  }
}

function drawMain(fb: Framebuffer, g: Game): void {
  // title plate over the mountains
  fb.fillRect(22, 10, W - 44, 46, OFF);
  fb.strokeRect(22, 10, W - 44, 46, WHITE);
  drawTextCentered(fb, 'PIXEL', CX, 15, WHITE, 3);
  drawTextCentered(fb, 'DESCENT', CX, 34, WHITE, 3);

  panel(fb, 146, 316);
  drawTextCentered(fb, `SEED ${g.seed}`, CX, 153, WHITE);
  const sb = g.seedBest;
  drawTextCentered(fb, sb > 0 ? `BEST ON SEED ${sb}` : 'NO SCORE ON THIS SEED YET', CX, 162);
  drawButtons(fb, g);
  const daily = g.store.seedBest(g.today);
  drawTextCentered(
    fb,
    `TODAY ${daily > 0 ? daily : '-'}   ALL TIME ${g.overallBest}`,
    CX,
    282,
    WHITE,
  );
  const c = nextChallenge(g);
  if (c) drawTextCentered(fb, `${c.name} ${c.value}/${c.target}`, CX, 287, YELLOW);
  drawTextCentered(fb, 'A D STEER  SPACE TRICK  P PAUSE', CX, 296);
  drawTextCentered(
    fb,
    g.ghost ? 'RACE YOUR GHOST ON THIS SEED' : 'M SOUND  H BIG HUD  U MUSIC',
    CX,
    305,
  );
}

/** The unfinished challenge closest to done. */
function nextChallenge(g: Game): { name: string; value: number; target: number } | null {
  let best: { name: string; value: number; target: number; f: number } | null = null;
  for (const c of CHALLENGES) {
    if (challengeDone(c, g.progress)) continue;
    const v = Math.min(c.target, Math.floor(c.value(g.progress)));
    const f = v / c.target;
    if (!best || f > best.f) best = { name: c.name, value: v, target: c.target, f };
  }
  return best;
}

function drawScores(fb: Framebuffer, g: Game): void {
  panel(fb, 4, 316);
  drawTextCentered(fb, 'TOP 10', CX, 12, WHITE, 2);
  const seedLabel = g.scoreTab === 'daily' ? g.today : g.seed;
  drawButtons(fb, g, g.scoreTab === 'daily' ? 'tabDaily' : 'tabSeed');
  drawTextCentered(fb, `SEED ${seedLabel}`, CX, 62, YELLOW);
  const list = g.store.leaderboard(seedLabel);
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
  drawTextCentered(fb, `ALL TIME BEST ${g.overallBest}`, CX, 206);
  drawTextCentered(
    fb,
    g.scoreTab === 'seed' && g.ghost ? 'GHOST SAVED FOR THIS SEED' : '',
    CX,
    220,
    WHITE,
  );
  drawTextCentered(fb, 'SCORES STAY ON THIS DEVICE', CX, 262);
}

function gearRow(
  fb: Framebuffer,
  g: Game,
  title: string,
  list: readonly GearDef[],
  idx: number,
  y: number,
): void {
  const def = list[idx];
  if (!def) return;
  drawTextCentered(fb, title, CX, y, WHITE);
  drawTextCentered(fb, def.name, CX, y + 20, YELLOW, 1);
  const unlocked = def.unlocked(g.progress);
  drawTextCentered(fb, unlocked ? 'UNLOCKED' : def.need, CX, y + 38, unlocked ? WHITE : YELLOW);
  drawTextCentered(fb, `${idx + 1}/${list.length}`, CX, y + 46, WHITE);
}

function drawGear(fb: Framebuffer, g: Game): void {
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
  };
  drawRider(fb, pose, { style, time: g.animT });
  drawButtons(fb, g);
  const b = g.progress.gear.board;
  const r = g.progress.gear.rider;
  gearRow(fb, g, 'BOARD', BOARDS, boardIndex(b), 150);
  gearRow(fb, g, 'RIDER', RIDERS, riderIndex(r), 200);
  drawTextCentered(fb, 'UNLOCK GEAR BY PLAYING', CX, 270);
}

function drawGoals(fb: Framebuffer, g: Game): void {
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

function drawPause(fb: Framebuffer, g: Game): void {
  panel(fb, 50, 214);
  drawTextCentered(fb, 'PAUSED', CX, 56, WHITE, 2);
  drawButtons(fb, g);
  drawTextCentered(fb, `SEED ${g.seed}`, CX, 184, WHITE);
  drawTextCentered(fb, 'P, ESC OR TAP TO RESUME', CX, 196, YELLOW);
}

function drawOver(fb: Framebuffer, g: Game): void {
  const res = g.result;
  if (!res) return;
  const t = Math.min(1, (g.animT - g.overAt) / PANEL_SLIDE);
  const ease = g.reduced ? 1 : 1 - Math.pow(1 - t, 3);
  const top = Math.round(H + (OVER_PANEL_TOP - H) * ease);
  const dy = top - OVER_PANEL_TOP;
  panel(fb, top, top + 164);
  drawTextCentered(fb, g.crashWord(), CX, top + 6, WHITE, 2);
  drawTextCentered(fb, String(res.score), CX, top + 21, YELLOW, 3);
  if (res.newSeedBest) {
    if (blink(g)) drawTextCentered(fb, 'NEW BEST ON THIS SEED!', CX, top + 41, YELLOW);
  } else {
    drawTextCentered(fb, `BEST ${g.seedBest}`, CX, top + 41, WHITE);
  }
  const sm = res.summary;
  drawTextCentered(fb, `${res.dist}M  STARS ${sm.stars}  CLOSE ${sm.nearMisses}`, CX, top + 51);
  drawTextCentered(
    fb,
    `FLAGS ${sm.gates}  TRICKS ${sm.tricks}  COMBO X${Math.max(1, sm.maxCombo)}`,
    CX,
    top + 60,
  );
  const rank = res.rank;
  drawTextCentered(
    fb,
    rank ? `PLACE #${rank} ON THIS SEED` : 'NOT IN THE TOP 10 FOR THIS SEED',
    CX,
    top + 71,
    rank ? WHITE : WHITE,
  );
  // new achievements and gear take turns in one line
  const news: string[] = [
    ...res.achievements.map((a) => `GOAL: ${a.name}`),
    ...res.gear.map((u) => `UNLOCKED: ${u.name}`),
  ];
  if (news.length > 0) {
    const n = news[Math.floor(g.animT / 1.4) % news.length] ?? '';
    drawTextCentered(fb, n, CX, top + 82, YELLOW);
  } else if (res.newOverallBest) {
    drawTextCentered(fb, 'NEW ALL TIME BEST', CX, top + 82, YELLOW);
  }
  const buttons = menuButtons(g);
  for (let i = 0; i < buttons.length; i++) {
    const bt = buttons[i];
    if (bt) drawButton(fb, g, bt, g.focusVisible && i === g.focus, dy);
  }
  drawTextCentered(fb, 'SPACE NEW  R RETRY  C SHARE', CX, top + 146);
  const toast = g.toasts[0];
  if (toast) {
    drawTextHalo(fb, toast.text, Math.round(CX - textWidth(toast.text) / 2), top - 10, YELLOW);
  }
}
