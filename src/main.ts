import { Sfx } from './platform/audio';
import { H, INGEST_PATH, W } from './core/config';
import { Game } from './state/game';
import { Input } from './platform/input';
import { Loop } from './platform/loop';
import { codeFromPath, decodeDare } from './core/dare';
import { normalizeSeed } from './core/rng';
import { Framebuffer } from './render/framebuffer';
import { lessonBoxes } from './render/lesson';
import { SceneRenderer } from './render/scene';
import { renderUi } from './render/ui';
import { shareResult } from './platform/shareDom';
import { analyticsConfig, DEBUG_SCRIPT, noTracker, startWebAnalytics } from './platform/analytics';
import {
  fanOut,
  posthogConfig,
  startPostHog,
  visitId,
  type PostHogConfig,
  type PostHogTracker,
} from './platform/posthog';
import { gameLoadedEvent, Session, type Landing } from './state/telemetry';
import { Store } from './state/storage';
import { fitCanvas, type Fit } from './platform/viewport';
import { SharpCanvas, frameBox, slideRows, slopeBox } from './platform/present';

/** Analytics settings baked in by `vite.config.ts`: null unless built on Vercel or with `VITE_ANALYTICS=1`. */
declare const __ANALYTICS__: {
  debug: boolean;
  vercelConfig: string;
  posthogKey: string;
  posthogEndpoint: string;
} | null;

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
const wash = required<HTMLElement>('wash');
const slopeLayer = new SharpCanvas(canvas);
const uiLayer = new SharpCanvas(uiCanvas);

const store = new Store();
const sfx = new Sfx();
const input = new Input(canvas);
const params = new URLSearchParams(window.location.search);
// A friend's dare (`/c/<code>`, served by the dare page function) or an older plain course link (`?seed=`).
const dareCode = codeFromPath(window.location.pathname);
const dare = decodeDare(dareCode);
const fromShare = dare !== null || dareCode !== null || params.has('seed');

// A shared link opens its course once. Clearing it keeps seeds out of sight, and a reload starts fresh.
if (fromShare) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    url.pathname = url.pathname.replace(/c\/[^/]*\/?$/, '');
    window.history.replaceState(null, '', url);
  } catch {
    // History can be unavailable (sandboxed frames). The link still opens its course.
  }
}

// Anonymous page views and game events (README, Privacy). Started after the seed has left the address bar. Every
// event goes to Vercel (which keeps the first `ANALYTICS_MAX_PROPS` properties) and, with a project key, to PostHog.
const analyticsBuild = __ANALYTICS__;
const vercel = analyticsBuild
  ? startWebAnalytics(
      window,
      document,
      analyticsBuild.debug
        ? { scriptSrc: DEBUG_SCRIPT }
        : analyticsConfig(analyticsBuild.vercelConfig),
      fromShare,
    )
  : noTracker;
const posthogSettings =
  analyticsBuild &&
  posthogConfig(analyticsBuild.posthogKey, analyticsBuild.posthogEndpoint || `/${INGEST_PATH}`);
const posthog = posthogSettings ? startPostHogTracker(posthogSettings) : null;
const analytics = posthog ? fanOut(vercel, posthog) : vercel;

function startPostHogTracker(config: PostHogConfig): PostHogTracker | null {
  try {
    const beacon = typeof navigator.sendBeacon === 'function';
    return startPostHog(
      config,
      {
        sendBeacon: beacon ? (url, body) => navigator.sendBeacon(url, body) : undefined,
        fetch: (url, init) => fetch(url, init),
      },
      visitId((bytes) => crypto.getRandomValues(bytes)),
    );
  } catch {
    // No crypto (a very old browser): no PostHog.
    return null;
  }
}

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
      // Dare links go on the site the game is on, whatever path it was opened at.
      const outcome = await shareResult(card, new URL('.', window.location.href).href);
      game.trackShare(outcome.via);
      return outcome.message;
    },
    analytics,
    fromShare,
  },
  normalizeSeed(params.get('seed')),
  dare,
);

/**
 * The slope: the 180x320 frame plus `above` and `below` rows of slope so it reaches the screen's edges on a tall phone,
 * and one spare row at the bottom, revealed as it slides up by the camera's fraction of a pixel. Rebuilt when the layout
 * asks for a different number of rows.
 */
let fb = new Framebuffer(W, H + 1);
let scene = new SceneRenderer(fb);
let image = new ImageData(fb.data, W, fb.h);
let slopeRows = { above: 0, below: 0 };

function sizeSlope(above: number, below: number): void {
  if (above === slopeRows.above && below === slopeRows.below) return;
  slopeRows = { above, below };
  fb = new Framebuffer(W, above + H + below + 1);
  scene = new SceneRenderer(fb, above);
  image = new ImageData(fb.data, W, fb.h);
}

const uiFb = new Framebuffer(W, H);
const uiImage = new ImageData(uiFb.data, W, H);
/** The last layout. */
let fit: Fit = fitCanvas(W, H, 1);

/** Both layers go through `SharpCanvas`: crisp at any scale, and the slope's slide is drawn into its own pixels. */
function render(alpha: number): void {
  game.setBlend(alpha);
  scene.render(game);
  uiFb.clear(0);
  renderUi(uiFb, game);
  slopeLayer.draw(image, slideRows(game.camFrac, fit.scale));
  uiLayer.draw(uiImage);
  if (stage.dataset['phase'] !== game.phase) stage.dataset['phase'] = game.phase;
  if (stage.dataset['screen'] !== game.screen) stage.dataset['screen'] = game.screen;
  const lesson = game.lessonWaiting ? 'on' : 'off';
  if (stage.dataset['lesson'] !== lesson) stage.dataset['lesson'] = lesson;
  const hole = washHole();
  if (hole !== washClip) {
    washClip = hole;
    wash.style.clipPath = hole;
  }
}

let washClip = '';

/**
 * A tutorial lesson's fade leaves the things it is about clear: the whole screen minus their boxes, in CSS px. The
 * boxes never overlap (`lessonBoxes` joins any that touch), so the even-odd rule cuts each one out.
 */
function washHole(): string {
  const boxes = game.lesson ? lessonBoxes(game) : [];
  if (boxes.length === 0) return '';
  const k = fit.cssW / W;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const holes = boxes.map((b) => {
    const x = fit.left + b.x * k;
    const y = fit.top + b.y * k;
    return `M${x} ${y}h${b.w * k}v${b.h * k}h${-b.w * k}Z`;
  });
  return `path(evenodd, 'M0 0H${vw}V${vh}H0Z ${holes.join(' ')}')`;
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
  const viewW = document.documentElement.clientWidth;
  const viewH = document.documentElement.clientHeight;
  // Not innerWidth or innerHeight: iOS Safari shrinks those while the page is zoomed, which would shrink the picture too.
  fit = fitCanvas(viewW, viewH, dpr, safe, touch ? TOUCH_MARGIN : 0, touch);
  stage.style.width = `${fit.cssW}px`;
  stage.style.height = `${fit.cssH}px`;
  stage.style.left = `${fit.left}px`;
  stage.style.top = `${fit.top}px`;
  sizeSlope(fit.above, fit.below);
  // Each canvas covers its box pixel for pixel, the slope from `above` rows over the frame to the screen's bottom, the
  // HUD exactly the frame: `SharpCanvas` does all the scaling, so no browser filter ever touches the picture.
  slopeLayer.resize(W, fb.h, fit.scale, slopeBox(fit, dpr, fb.h));
  uiLayer.resize(W, H, fit.scale, frameBox(fit, dpr));
}

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
layout();

pauseBtn.addEventListener('click', () => {
  input.push('pause');
  pauseBtn.blur();
});
/** How this page was opened, for Game Loaded. */
function landing(): Landing {
  if (dare) return 'dare';
  if (dareCode !== null) return 'broken_dare';
  return params.has('seed') ? 'old_link' : 'home';
}

// Analytics sessions: Session Ended each time the page is hidden, sent at once with everything else waiting, since
// a hidden page may never come back. A run still going when the page goes away ends as left.
const session = new Session(performance.now(), game.visitRuns);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.autoPause();
    const ended = session.hide(performance.now(), game.visitRuns);
    if (ended) game.track(ended);
    posthog?.flush();
  } else {
    session.show(performance.now(), game.visitRuns);
  }
});
window.addEventListener('pagehide', () => {
  game.leave();
  posthog?.flush();
});
window.addEventListener('blur', () => game.autoPause());
// Browsers start audio only from a gesture, and iOS counts a lifted touch, not a touch down: so audio, and with it the
// soundtrack, starts on the first of these and comes back after an interruption on the next.
for (const type of ['pointerup', 'touchend', 'keydown', 'click'] as const) {
  window.addEventListener(type, () => sfx.gesture(), { capture: true, passive: true });
}

const loop = new Loop((dt) => game.update(dt), render);
loop.start();
// The page is playable once the first frame is drawn. performance.now() counts from the navigation.
requestAnimationFrame(() => game.track(gameLoadedEvent(performance.now(), landing())));

if (import.meta.env.DEV) {
  // Debug handles for end-to-end checks in dev builds only.
  Object.assign(window, { __game: game, __input: input, __store: store });
}
