import { Sfx } from './platform/audio';
import { H, W } from './core/config';
import { Game } from './state/game';
import { Input } from './platform/input';
import { Loop } from './platform/loop';
import { normalizeSeed } from './core/rng';
import { Framebuffer } from './render/framebuffer';
import { SceneRenderer } from './render/scene';
import { renderUi } from './render/ui';
import { shareResult } from './platform/shareDom';
import { Store } from './state/storage';
import { fitCanvas } from './platform/viewport';

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const canvas = required<HTMLCanvasElement>('game');
const stage = required<HTMLElement>('stage');
const pauseBtn = required<HTMLButtonElement>('pause-btn');
const safeProbe = required<HTMLElement>('safe');
const status = required<HTMLElement>('status');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('2D canvas is not supported');
ctx.imageSmoothingEnabled = false;

const store = new Store();
const sfx = new Sfx();
const input = new Input(canvas);
const params = new URLSearchParams(window.location.search);

// A shared link opens its course once. Clearing it keeps seeds out of sight, and a reload starts fresh.
if (params.has('seed')) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    window.history.replaceState(null, '', url);
  } catch {
    // History can be unavailable (sandboxed frames). The link still opens its course.
  }
}

/** Map a pointer position to the 180x320 logical canvas. */
input.logical = (clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
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
    share: (card) => shareResult(card, window.location.href),
  },
  normalizeSeed(params.get('seed')),
);

const fb = new Framebuffer(W, H);
const scene = new SceneRenderer(fb);
const image = new ImageData(fb.data, W, H);

function render(): void {
  scene.render(game);
  renderUi(fb, game);
  ctx?.putImageData(image, 0, 0);
  if (stage.dataset['phase'] !== game.phase) stage.dataset['phase'] = game.phase;
}

/** CSS px of black kept around the picture on touch screens. */
const TOUCH_MARGIN = 10;

function layout(): void {
  const css = getComputedStyle(safeProbe);
  const safe = {
    top: parseFloat(css.paddingTop) || 0,
    right: parseFloat(css.paddingRight) || 0,
    bottom: parseFloat(css.paddingBottom) || 0,
    left: parseFloat(css.paddingLeft) || 0,
  };
  // On a touch screen keep the picture clear of rounded corners and bezels, so the score is never clipped.
  const margin = window.matchMedia('(pointer: coarse)').matches ? TOUCH_MARGIN : 0;
  const fit = fitCanvas(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio || 1,
    safe,
    margin,
  );
  stage.style.width = `${fit.cssW}px`;
  stage.style.height = `${fit.cssH}px`;
  stage.style.left = `${fit.left}px`;
  stage.style.top = `${fit.top}px`;
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
