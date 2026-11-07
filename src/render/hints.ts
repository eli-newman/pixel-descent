import { H, HINT_RUNS, W } from '../core/config';
import { isPebble } from '../sim/collision';
import type { GameView } from '../state/view';
import { drawTextHalo, textWidth } from './font';
import { Framebuffer, YELLOW } from './framebuffer';
import { gaugeRect, hudRect } from './layout';
import { getSprite } from './sprites';

/** What each kind of thing on the slope does, in the words its label shows. Pebbles get none: they are only decoration. */
type HintKind = 'tree' | 'dead' | 'rock' | 'bush' | 'ice' | 'drift' | 'star';

export const HINT_TEXT: Readonly<Record<HintKind, string>> = {
  tree: 'CRASH',
  dead: 'CRASH',
  rock: 'CRASH',
  bush: 'SLOWS',
  ice: 'ICE',
  drift: 'DEEP SNOW',
  star: '+30',
};

/** Whether this frame labels the slope: only while riding one of the player's first runs. */
export function hintsOn(g: GameView): boolean {
  return g.phase === 'playing' && g.progress.stats.hintRuns < HINT_RUNS;
}

interface Spot {
  kind: HintKind;
  /** World y used to pick the nearest one ahead. */
  wy: number;
  /** Label centre x and the screen row of the top of the thing. */
  x: number;
  top: number;
}

/**
 * On a player's first runs, put a small label over the next thing of each kind below the rider: what it
 * does, not what it is called. One label per kind, never over the score, never on top of another label.
 * The labels ride with the slope and do not blink.
 */
export function drawHints(fb: Framebuffer, g: GameView): void {
  if (!hintsOn(g)) return;
  const sim = g.sim;
  const cam = g.camYi;
  const feet = sim.rider.y + 8;
  const near = new Map<HintKind, Spot>();
  const offer = (s: Readonly<Spot>): void => {
    if (s.wy <= feet || s.top - cam > H - 12) return;
    const best = near.get(s.kind);
    if (!best || s.wy < best.wy) near.set(s.kind, s);
  };
  for (const o of sim.obstacles) {
    if (isPebble(o.kind, o.size)) continue;
    offer({ kind: o.kind, wy: o.y, x: o.x, top: o.y + getSprite(o.kind, o.size, o.variant).top });
  }
  for (const p of sim.patches) offer({ kind: p.kind, wy: p.y, x: p.x, top: p.y - p.ry });
  for (const p of sim.pickups) if (!p.taken) offer({ kind: 'star', wy: p.y, x: p.x, top: p.y - 3 });

  const hud = hudRect(g.settings.bigHud);
  const gauge = gaugeRect(g.settings.bigHud);
  const used: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  // The rarer, non-lethal things win a crowded spot: the slope is full of trees to learn CRASH from.
  const rank = (s: Readonly<Spot>): number => (HINT_TEXT[s.kind] === 'CRASH' ? 1 : 0);
  for (const s of [...near.values()].sort((a, b) => rank(a) - rank(b) || a.wy - b.wy)) {
    const text = HINT_TEXT[s.kind];
    const w = textWidth(text);
    const x0 = Math.max(2, Math.min(W - 2 - w, Math.round(s.x - w / 2)));
    const y0 = s.top - cam - 8;
    // the halo plus a margin, so two labels never stack into one block of text
    const box = { x0: x0 - 4, y0: y0 - 8, x1: x0 + w + 4, y1: y0 + 13 };
    if (box.y0 < 0 || (box.x0 < hud.w + 2 && box.y0 < hud.h + 2)) continue;
    // nor half hidden behind the speed panel at the bottom left
    if (box.x0 < gauge.x + gauge.w + 2 && y0 + 7 > gauge.y) continue;
    if (used.some((u) => u.x0 < box.x1 && box.x0 < u.x1 && u.y0 < box.y1 && box.y0 < u.y1))
      continue;
    used.push(box);
    drawTextHalo(fb, text, x0, y0, YELLOW);
  }
}
