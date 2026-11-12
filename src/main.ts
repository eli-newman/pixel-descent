import { Sfx } from './platform/audio';
import { H, W } from './core/config';
import { Game } from './state/game';
import { Input } from './platform/input';
import { Loop } from './platform/loop';
import { normalizeSeed } from './core/rng';
import { cssColor, Framebuffer } from './render/framebuffer';
import { paletteFor } from './render/palette';
import { SceneRenderer } from './render/scene';
import { renderUi } from './render/ui';
import { shareResult } from './platform/shareDom';
import { analyticsConfig, DEBUG_SCRIPT, noTracker, startWebAnalytics } from './platform/analytics';
import { shareEvent } from './state/telemetry';
import { Store } from './state/storage';
import { fitCanvas, slideTransform } from './platform/viewport';

/** Analytics settings baked in by `vite.config.ts`: null unless built on Vercel or with `VITE_ANALYTICS=1`. */
declare const __ANALYTICS__: { debug: boolean; vercelConfig: string } | null;

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const canvas = required<HTMLCanvasElement>('game');
const uiCanvas = required<HTMLCanvasElement>('ui');
const stage = required<HTMLElement>('stage');
const pauseBtn = required<HTMLButtonElement>('pause-btn');
const safeProbe = required<HTMLElement>('safe');
const status = required<HTMLElement>('status');
uiCanvas.width = W;
uiCanvas.height = H;
const ctx = canvas.getContext('2d', { alpha: false });
const uiCtx = uiCanvas.getContext('2d');
if (!ctx || !uiCtx) throw new Error('2D canvas is not supported');
ctx.imageSmoothingEnabled = false;
uiCtx.imageSmoothingEnabled = false;

const store = new Store();
const sfx = new Sfx();
const input = new Input(canvas);
const params = new URLSearchParams(window.location.search);
const fromShare = params.has('seed');

// A shared link opens its course once. Clearing it keeps seeds out of sight, and a reload starts fresh.
if (fromShare) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    window.history.replaceState(null, '', url);
  } catch {
    // History can be unavailable (sandboxed frames). The link still opens its course.
  }
}

// Anonymous page views and run events (README, Privacy). Started after the seed has left the address bar.
const analyticsBuild = __ANALYTICS__;
const analytics = analyticsBuild
  ? startWebAnalytics(
      window,
      document,
      analyticsBuild.debug
        ? { scriptSrc: DEBUG_SCRIPT }
        : analyticsConfig(analyticsBuild.vercelConfig),
      fromShare,
    )
  : noTracker;

/** Map a pointer position to the 180x320 logical canvas. */
input.logical = (clientX, clientY) => {
  // The stage, not the slope canvas: that one is a row taller and slides.
  const rect = stage.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * W,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * H,
  };
};

const game = new Game(
  {
    store,
    input,
    sfx,
    haptic: (ms) => {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    },
    announce: (text) => {
      status.textContent = text;
    },
    share: async (card) => {
      const outcome = await shareResult(card, window.location.href);
      analytics.track(shareEvent(outcome.via));
      return outcome.message;
    },
    analytics,
  },
  normalizeSeed(params.get('seed')),
);

/**
 * The slope layer: the 180x320 frame plus `above` and `below` rows of slope so it reaches the screen's edges on a
 * tall phone, and one spare row at the bottom, revealed as it slides up by a fraction of a pixel. Rebuilt when the
 * layout asks for a different number of rows.
 */
let fb = new Framebuffer(W, H + 1);
let scene = new SceneRenderer(fb);
let image = new ImageData(fb.data, W, fb.h);
let slopeRows = { above: 0, below: 0 };
canvas.width = W;
canvas.height = fb.h;

function sizeSlope(above: number, below: number): void {
  if (above === slopeRows.above && below === slopeRows.below) return;
  slopeRows = { above, below };
  fb = new Framebuffer(W, above + H + below + 1);
  scene = new SceneRenderer(fb, above);
  image = new ImageData(fb.data, W, fb.h);
  canvas.width = W;
  canvas.height = fb.h;
}

const uiFb = new Framebuffer(W, H);
const uiImage = new ImageData(uiFb.data, W, H);
/** Device pixels per logical pixel, from the last layout. */
let scale = 1;
let shift = '';
let colorOn: boolean | null = null;

function render(alpha: number): void {
  game.setBlend(alpha);
  scene.render(game);
  uiFb.clear(0);
  renderUi(uiFb, game);
  ctx?.putImageData(image, 0, 0);
  uiCtx?.putImageData(uiImage, 0, 0);
  const next = slideTransform(game.camFrac, scale, window.devicePixelRatio || 1);
  if (next !== shift) {
    shift = next;
    canvas.style.transform = next;
  }
  if (stage.dataset['phase'] !== game.phase) stage.dataset['phase'] = game.phase;
  if (stage.dataset['screen'] !== game.screen) stage.dataset['screen'] = game.screen;
  const color = game.settings.color;
  if (color !== colorOn) {
    colorOn = color;
    // Wherever the slope does not reach (beside it on a wide screen, under a browser's toolbar), the page is its snow.
    document.body.style.background = cssColor(paletteFor(color).snow);
    stage.dataset['color'] = color ? 'on' : 'off';
  }
}

/** CSS px kept clear around the frame on a touch screen that it does not fill (held sideways, or a tablet). */
const TOUCH_MARGIN = 10;

function layout(): void {
  const css = getComputedStyle(safeProbe);
  const safe = {
    top: parseFloat(css.paddingTop) || 0,
    right: parseFloat(css.paddingRight) || 0,
    bottom: parseFloat(css.paddingBottom) || 0,
    left: parseFloat(css.paddingLeft) || 0,
  };
  // A phone fills its screen edge to edge. Elsewhere on a touch screen keep the picture clear of rounded corners.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const dpr = window.devicePixelRatio || 1;
  // Not innerWidth or innerHeight: iOS Safari shrinks those while the page is zoomed, which would shrink the picture too.
  const fit = fitCanvas(
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
    dpr,
    safe,
    touch ? TOUCH_MARGIN : 0,
    touch,
  );
  scale = fit.scale;
  stage.style.width = `${fit.cssW}px`;
  stage.style.height = `${fit.cssH}px`;
  stage.style.left = `${fit.left}px`;
  stage.style.top = `${fit.top}px`;
  sizeSlope(fit.above, fit.below);
  // The slope canvas starts `above` rows over the frame and runs on past it, at the frame's scale.
  canvas.style.top = `${(-fit.above * fit.scale) / dpr}px`;
  canvas.style.height = `${(fb.h * fit.scale) / dpr}px`;
}

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
layout();

pauseBtn.addEventListener('click', () => {
  input.push('pause');
  pauseBtn.blur();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.autoPause();
});
window.addEventListener('blur', () => game.autoPause());

const loop = new Loop((dt) => game.update(dt), render);
loop.start();

if (import.meta.env.DEV) {
  // Debug handles for end-to-end checks in dev builds only.
  Object.assign(window, { __game: game, __input: input, __store: store });
}
