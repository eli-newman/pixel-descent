import { Sfx } from './audio';
import { H, W } from './config';
import { Game } from './game';
import { Input } from './input';
import { Loop } from './loop';
import { normalizeSeed } from './rng';
import { Framebuffer } from './render/framebuffer';
import { SceneRenderer } from './render/scene';
import { renderUi } from './render/ui';
import { loadBest, saveBest } from './storage';
import { fitCanvas } from './viewport';

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const canvas = required<HTMLCanvasElement>('game');
const stage = required<HTMLElement>('stage');
const pauseBtn = required<HTMLButtonElement>('pause-btn');
const status = required<HTMLElement>('status');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('2D canvas is not supported');
ctx.imageSmoothingEnabled = false;

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const sfx = new Sfx();
const input = new Input(canvas);
const params = new URLSearchParams(window.location.search);

const game = new Game(
  {
    best: loadBest(),
    input,
    sfx,
    reducedMotion: () => reducedQuery.matches,
    saveBest,
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
  },
  normalizeSeed(params.get('seed')),
);

const fb = new Framebuffer(W, H);
const scene = new SceneRenderer(fb);
const image = new ImageData(fb.data, W, H);

function render(): void {
  scene.render(game);
  renderUi(fb, game, !sfx.muted);
  ctx?.putImageData(image, 0, 0);
  pauseBtn.classList.toggle('active', game.phase === 'playing' || game.phase === 'paused');
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.autoPause();
});
window.addEventListener('blur', () => game.autoPause());

const loop = new Loop((dt) => game.update(dt), render);
loop.start();

if (import.meta.env.DEV) {
  // Debug handles for end-to-end checks in dev builds only.
  Object.assign(window, { __game: game, __input: input });
}
