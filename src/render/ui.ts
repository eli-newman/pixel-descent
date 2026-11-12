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
import { drawTextHalo, drawTextHaloCentered, textWidth } from './font';
import { Framebuffer } from './framebuffer';
import { GAUGE_BAR, gaugeRect, riderBox } from './layout';
import { MONO, paletteFor } from './palette';
import { drawRider, type RiderStyle } from './riderSprite';
import type { RiderPose } from '../sim/pose';

const CX = W / 2;

/**
 * The UI colours of the frame being drawn (`Palette.ui`, `uiHot`, `uiEdge`), set at the start of every `renderUi`.
 * Nothing in the UI sits on a box: the slope shows through everywhere, and every word and frame carries a one
 * pixel edge in the slope's own tone, so it reads over trees, rocks and sky.
 */
let INK = MONO.ui;
let HOT = MONO.uiHot;
let EDGE = MONO.uiEdge;

function frame(fb: Framebuffer, x: number, y: number, w: number, h: number, color: number): void {
  fb.strokeRect(x - 1, y - 1, w + 2, h + 2, EDGE);
  if (w > 2 && h > 2) fb.strokeRect(x + 1, y + 1, w - 2, h - 2, EDGE);
  fb.strokeRect(x, y, w, h, color);
}

function text(fb: Framebuffer, t: string, x: number, y: number, color = INK, scale = 1): void {
  drawTextHalo(fb, t, x, y, color, scale, EDGE);
}

function textC(fb: Framebuffer, t: string, cx: number, y: number, color = INK, scale = 1): void {
  drawTextHaloCentered(fb, t, cx, y, color, scale, EDGE);
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
    case 'snowboard':
      return 'SNOWBOARD';
    case 'skis':
      return 'SKIS';
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
    case 'color':
      return `COLOR ${on(g.settings.color)}`;
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
  const edge = bt.accent || selected ? HOT : INK;
  frame(fb, bt.x, y, bt.w, bt.h, edge);
  if (focused) frame(fb, bt.x + 2, y + 2, bt.w - 4, bt.h - 4, HOT);
  const label = labelOf(g, bt.id);
  const scale = bt.accent && bt.h >= 26 ? 2 : 1;
  const ty = y + Math.round((bt.h - 5 * scale) / 2);
  textC(fb, label, bt.x + bt.w / 2, ty, bt.accent || selected ? HOT : INK, scale);
}

/** Heads-up display, title, pause and game over screens, all drawn into the low-res buffer. */
export function renderUi(fb: Framebuffer, g: GameView): void {
  const pal = paletteFor(g.settings.color);
  INK = pal.ui;
  HOT = pal.uiHot;
  EDGE = pal.uiEdge;
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
  const s1 = big ? 3 : 2;
  const s2 = big ? 2 : 1;
  text(fb, String(g.sim.scoreValue), 4, 4, HOT, s1);
  let y = 4 + 5 * s1 + 3;
  text(fb, `${sim.distM}M`, 4, y, INK, s2);
  y += 5 * s2 + 3;
  text(fb, `BEST ${g.overallBest}`, 4, y, INK, s2);

  if (g.phase === 'playing' || g.phase === 'crashed') drawGauges(fb, g);
  if (g.settings.muted) text(fb, 'MUTED', W - 26, H - 8);

  const toast = g.toasts[0];
  if (toast && g.phase !== 'over') {
    const x = Math.round(CX - textWidth(toast.text) / 2);
    const ty = toastRow(g, big);
    text(fb, toast.text, x, ty, toast.hot ? HOT : INK);
    if (toast.sub) {
      const sx = Math.round(CX - textWidth(toast.sub) / 2);
      text(fb, toast.sub, sx, ty + SUB_GAP, toast.hot ? HOT : INK);
    }
  }
}

/** Toast rows: the usual one, and one lower down for when a jump carries the rider up through it. The combo meter sits `comboGap` under the toast. */
const TOAST_ROW = 52;
const TOAST_ROW_BIG = 66;
const TOAST_ROW_LOW = 124;
/** Half the width of the combo meter with its label. */
const TOAST_HALF = 36;

/** How far under a toast its `sub` line sits. */
const SUB_GAP = 8;

/** How far under the toast the combo meter sits: below the toast's `sub` line when it has one. */
function comboGap(g: GameView, big: boolean): number {
  return (big ? 12 : 10) + (g.toasts[0]?.sub ? SUB_GAP : 0);
}

/**
 * The toast's row. A high jump lifts the rider up through the usual row, and a toast there (or the
 * combo meter under it) would hide the very trick it names, so while he is in that band both sit
 * lower down instead.
 */
function toastRow(g: GameView, big: boolean): number {
  const ty = big ? TOAST_ROW_BIG : TOAST_ROW;
  if (!g.sim.rider.air) return ty;
  const rider = riderBox(g.sim, g.camYi);
  const toast = g.toasts[0];
  const wide = Math.max(textWidth(toast?.text ?? ''), textWidth(toast?.sub ?? ''));
  const meter = g.sim.score.combo > 0 && g.sim.comboLeft > 0;
  const half = Math.max(wide / 2, meter ? TOAST_HALF : 0) + 2;
  const across = rider.left <= CX + half && rider.right >= CX - half;
  const down = rider.top <= ty + comboGap(g, big) + 6 && rider.bottom >= ty - 1;
  return across && down ? TOAST_ROW_LOW : ty;
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
  const panel = gaugeRect(big);
  const gy = panel.y + 1;
  // speed bar: fills towards top speed, ticks show cruising speed
  const bw = GAUGE_BAR;
  text(fb, label, 4, gy, hot ? HOT : INK, sc);
  text(fb, ms, 4 + textWidth(label, sc) + 4, gy, hot ? HOT : INK, sc);
  const by = gy + 5 * sc + 2;
  frame(fb, 4, by, bw, 4, INK);
  const fill = Math.round((bw - 2) * Math.min(1, sim.rider.speed / 340));
  fb.fillRect(5, by + 1, fill, 2, hot ? HOT : INK);

  if (!live) return;
  // combo meter: a bar that drains as the combo window runs out
  if (sim.score.combo > 0 && sim.comboLeft > 0) {
    const w = 44;
    const x = Math.round(CX - w / 2);
    const y = toastRow(g, big) + comboGap(g, big);
    const label2 = `X${sim.score.combo}`;
    text(fb, label2, x - textWidth(label2) - 4, y - 1, HOT);
    frame(fb, x, y - 1, w, 6, HOT);
    fb.fillRect(x + 1, y, Math.round((w - 2) * sim.comboLeft), 4, HOT);
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
  textC(fb, 'POW', CX, 15, INK, 3);
  textC(fb, 'LINE', CX, 34, INK, 3);
  const best = g.overallBest;
  textC(fb, best > 0 ? `BEST ${best}` : 'NO SCORE YET', CX, 155, INK, 2);
  drawButtons(fb, g);
  const daily = g.dailyBest;
  textC(fb, daily > 0 ? `TODAY'S BEST ${daily}` : 'NO DAILY RUN YET', CX, 279, INK);
  const c = nextChallenge(g);
  if (c) textC(fb, `${c.name} ${c.value}/${c.target}`, CX, 288, HOT);
  textC(
    fb,
    g.touch ? 'HOLD SIDE STEER  SWIPE SPIN OR FLIP' : 'A D STEER  SPACE TRICK  W S FLIP',
    CX,
    297,
  );
  textC(
    fb,
    g.touch ? 'TAP IN AIR GRAB  2 FINGERS BRAKE' : 'X GRAB  A+D BRAKE  P PAUSE  M SOUND',
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
  textC(fb, 'TOP 10', CX, 12, INK, 2);
  const daily = g.scoreTab === 'daily';
  drawButtons(fb, g, daily ? 'tabDaily' : 'tabTop');
  textC(fb, daily ? "TODAY'S COURSE" : 'YOUR BEST RUNS', CX, 62, HOT);
  const list = daily ? g.dailyRuns : g.topRuns;
  for (let i = 0; i < 10; i++) {
    const e = list[i];
    const y = 76 + i * 12;
    text(fb, String(i + 1).padStart(2, ' '), 16, y, INK);
    if (e) {
      text(fb, String(e.score), 36, y, i === 0 ? HOT : INK);
      text(fb, `${e.dist}M`, 86, y, INK);
      text(fb, e.date.slice(5).replace('-', '/'), 128, y, INK);
    } else {
      text(fb, '-', 36, y, INK);
    }
  }
  textC(fb, 'SCORES STAY ON THIS DEVICE', CX, 262);
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
  textC(fb, title, CX, y, INK);
  textC(fb, def.name, CX, y + 23, HOT, 1);
  const unlocked = def.unlocked(g.progress);
  textC(fb, unlocked ? 'UNLOCKED' : def.need, CX, y + 36, unlocked ? INK : HOT);
  void idx;
}

/** Offscreen canvas for the GEAR preview, built once. */
const PREVIEW = new Framebuffer(48, 48);
/** Middle of the gap between the SNOWBOARD / SKIS buttons (bottom 56) and the first gear row (top 150). */
const PREVIEW_MID_Y = 103;

/** Bounds of the lit pixels, or null when nothing is lit. */
function litBox(src: Framebuffer): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = src.w;
  let y0 = src.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (!src.isOn(x, y)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function drawGear(fb: Framebuffer, g: GameView): void {
  textC(fb, 'GEAR', CX, 12, INK, 2);
  const skis = g.progress.gear.kit === 'skis';
  const style: RiderStyle = { board: g.boardIdx, rider: g.riderIdx, skis };
  const palette = paletteFor(g.settings.color);
  // A rider doing a slow carve, drawn at twice the scale and centred in the gap between the kit buttons and the rows.
  const a = (62 * Math.PI) / 180;
  const pose: RiderPose = {
    x: PREVIEW.w / 2 + 8,
    y: PREVIEW.h / 2 + 4,
    nx: -Math.cos(a),
    ny: Math.sin(a),
    face: -1,
    stance: 1,
    up: 1,
    ang: 62,
    steep: false,
    tuck: 0,
    pitch: 0,
    grab: false,
  };
  // Measured on a still frame, so animated headgear never nudges the whole preview.
  PREVIEW.clear();
  drawRider(PREVIEW, pose, { style, time: 0, palette });
  const box = litBox(PREVIEW);
  PREVIEW.clear();
  drawRider(PREVIEW, pose, { style, time: g.animT, palette });
  if (box) {
    const midX = Math.round((box.x0 + box.x1 + 1) / 2);
    const midY = Math.round((box.y0 + box.y1 + 1) / 2);
    fb.blitScaled(PREVIEW, CX - midX * 2, PREVIEW_MID_Y - midY * 2, 2);
  }
  drawButtons(fb, g, skis ? 'skis' : 'snowboard');
  const b = g.progress.gear.board;
  const r = g.progress.gear.rider;
  // The board looks are drawn on the skis too.
  gearRow(fb, g, skis ? 'SKIS' : 'BOARD', BOARDS, boardIndex(b), 150);
  gearRow(fb, g, 'RIDER', RIDERS, riderIndex(r), 200);
  textC(fb, 'UNLOCK GEAR BY PLAYING', CX, 270);
}

function drawGoals(fb: Framebuffer, g: GameView): void {
  textC(fb, 'GOALS', CX, 12, INK, 2);
  text(fb, 'CHALLENGES', 16, 32, HOT);
  CHALLENGES.forEach((c, i) => {
    const y = 44 + i * 20;
    const v = Math.min(c.target, Math.floor(c.value(g.progress)));
    const done = challengeDone(c, g.progress);
    text(fb, c.name, 16, y, done ? HOT : INK);
    text(
      fb,
      done ? 'DONE' : `${v}/${c.target}`,
      W - 16 - textWidth(done ? 'DONE' : `${v}/${c.target}`),
      y,
      INK,
    );
    frame(fb, 16, y + 8, W - 32, 5, INK);
    fb.fillRect(17, y + 9, Math.round(((W - 34) * v) / c.target), 3, done ? HOT : INK);
  });
  text(fb, `ACHIEVEMENTS ${g.achievementCount}/${ACHIEVEMENTS.length}`, 16, 134, HOT);
  let firstOpen = '';
  ACHIEVEMENTS.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const got = g.progress.achievements[a.id] !== undefined;
    if (!got && firstOpen === '') firstOpen = a.desc;
    const x = 16 + col * 80;
    const y = 148 + row * 14;
    text(fb, got ? '*' : '-', x, y, got ? HOT : INK);
    text(fb, a.name, x + 8, y, INK);
  });
  textC(fb, firstOpen !== '' ? `NEXT: ${firstOpen}` : 'ALL ACHIEVEMENTS EARNED', CX, 240, HOT);
  drawButtons(fb, g);
}

function drawPause(fb: Framebuffer, g: GameView): void {
  textC(fb, 'PAUSED', CX, 56, INK, 2);
  drawButtons(fb, g);
  // The spin mode is fixed for a run, so a change made here waits for the next one.
  if (g.settings.manualSpin !== (g.sim.opts.manualSpin === true)) {
    textC(fb, 'SPIN MODE STARTS NEXT RUN', CX, 232, HOT);
  }
  textC(fb, 'P, ESC OR TAP TO RESUME', CX, 242, HOT);
}

function drawOver(fb: Framebuffer, g: GameView): void {
  const res = g.result;
  if (!res) return;
  const top = OVER_PANEL_TOP;
  textC(fb, g.crashWord, CX, top + 6, INK, 2);
  textC(fb, String(res.score), CX, top + 21, HOT, 3);
  if (res.newBest) {
    textC(fb, 'NEW BEST!', CX, top + 41, HOT);
  } else {
    textC(fb, `BEST ${g.overallBest}`, CX, top + 41, INK);
  }
  const sm = res.summary;
  textC(fb, `${res.dist}M  STARS ${sm.stars}  CLOSE ${sm.nearMisses}`, CX, top + 51);
  textC(fb, `TRICKS ${sm.tricks}  COMBO X${Math.max(1, sm.maxCombo)}`, CX, top + 60);
  const rank = res.rank;
  textC(fb, rank ? `RANK ${rank} ALL TIME` : 'NOT IN YOUR TOP 10', CX, top + 71, INK);
  // new achievements and gear take turns in one line
  const news: string[] = [
    ...res.achievements.map((a) => `GOAL: ${a.name}`),
    ...res.gear.map((u) => `UNLOCKED: ${u.name}`),
  ];
  if (news.length > 0) {
    const n = news[Math.floor(g.animT / 1.4) % news.length] ?? '';
    textC(fb, n, CX, top + 80, HOT);
  }
  const buttons = menuButtons(g);
  for (let i = 0; i < buttons.length; i++) {
    const bt = buttons[i];
    if (bt) drawButton(fb, g, bt, g.focusVisible && i === g.focus);
  }
  textC(fb, 'SPACE NEW  R RETRY  C SHARE', CX, top + 146);
  const toast = g.toasts[0];
  if (toast) {
    text(fb, toast.text, Math.round(CX - textWidth(toast.text) / 2), top - 10, HOT);
  }
}
