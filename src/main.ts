import { Sfx } from './audio';
import { H, W } from './config';
import { Game } from './game';
import { Input } from './input';
import { Loop } from './loop';
import { normalizeSeed } from './rng';
import { Framebuffer } from './render/framebuffer';
import { SceneRenderer } from './render/scene';
import { renderUi } from './render/ui';
import { shareResult } from './shareDom';
import { Store } from './storage';
import { fitCanvas } from './viewport';

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const canvas = required<HTMLCanvasElement>('game');
const stage = required<HTMLElement>('stage');
const pauseBtn = required<HTMLButtonElement>('pause-btn');
const muteBtn = required<HTMLButtonElement>('mute-btn');
const trickBtn = required<HTMLButtonElement>('trick-btn');
const status = required<HTMLElement>('status');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('2D canvas is not supported');
ctx.imageSmoothingEnabled = false;

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const store = new Store();
const sfx = new Sfx();
const input = new Input(canvas);
const params = new URLSearchParams(window.location.search);

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
    reducedMotion: () => reducedQuery.matches,
    haptic: (ms) => {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    },
    onSeed: (seed) => {
      // Keep the address bar shareable: anyone opening this URL gets the same course.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('seed', seed);
        window.history.replaceState(null, '', url);
      } catch {
        // History can be unavailable (sandboxed frames); the seed is still shown on screen.
      }
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
let image: ImageData | null = null;

function render(): void {
  const out = scene.render(game);
  renderUi(out, game);
  if (!image || image.data !== out.data) image = new ImageData(out.data, W, H);
  ctx?.putImageData(image, 0, 0);
  if (stage.dataset['phase'] !== game.phase) stage.dataset['phase'] = game.phase;
  const muted = game.settings.muted;
  if (muteBtn.getAttribute('aria-pressed') !== String(muted)) {
    muteBtn.setAttribute('aria-pressed', String(muted));
  }
}

function layout(): void {
  const fit = fitCanvas(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
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
muteBtn.addEventListener('click', () => {
  input.push('mute');
  muteBtn.blur();
});
trickBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.usingTouch = true;
  input.push('trick');
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
