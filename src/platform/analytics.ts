/**
 * Vercel Web Analytics without the npm package: the same queue and script tag that `@vercel/analytics` injects.
 * No cookies and no stored identifiers. Page views are counted by the script itself; `Tracker.track` sends custom events.
 * Nothing here may throw, block or wait: a blocked or missing script leaves a silent no-op.
 */

import { ANALYTICS_MAX_PROPS } from '../core/config';

/** Event properties: flat strings, numbers and booleans only (the Vercel limit). */
export type EventData = Readonly<Record<string, string | number | boolean>>;

/** One custom event. Never put a seed, a share URL or anything personal in it. */
export interface AnalyticsEvent {
  readonly name: string;
  /** Most important first: only the first `ANALYTICS_MAX_PROPS` are sent. */
  readonly data: EventData;
}

/** What the game calls. Tests use a fake that records events. */
export interface Tracker {
  track(event: AnalyticsEvent): void;
}

/** Tracker that does nothing (tests, dev, builds that are not on Vercel). */
export const noTracker: Tracker = { track: () => {} };

/** Where the script lives and where it reports. Vercel sends the real values at build time. */
export interface AnalyticsConfig {
  scriptSrc: string;
  viewEndpoint?: string;
  eventEndpoint?: string;
}

/** The legacy path that every project with Web Analytics enabled serves. */
export const DEFAULT_SCRIPT = '/_vercel/insights/script.js';
/** Logs events to the console and sends nothing (for `VITE_ANALYTICS=1 npm run dev`). */
export const DEBUG_SCRIPT = 'https://va.vercel-scripts.com/v1/script.debug.js';
/** The page a visit that came from a shared link is reported as, so the Pages panel splits share arrivals from direct ones. */
export const FROM_SHARE_PATH = 'from-share';
/** Events queued while the script loads. If it never loads (offline, blocked) nothing grows past this. */
export const MAX_QUEUE = 50;

/** A path on this site, with or without the leading slash: no scheme, no `//` host, no `..`. */
const SITE_PATH = /^\/?[\w-]+(\/[\w-]+)*(\.js)?$/;

/**
 * Parse `VERCEL_OBSERVABILITY_CLIENT_CONFIG` (JSON with an `analytics` key, set by Vercel at build time).
 * Vercel gives the paths without a leading slash (`"76b40da1c7a41f39/script.js"`, a per-project path that ad
 * blockers do not know); they live at the site root, so they are made root-relative, as `@vercel/analytics` does.
 * Anything missing, malformed or on another origin falls back to the default script path.
 */
export function analyticsConfig(json: string | undefined): AnalyticsConfig {
  const out: AnalyticsConfig = { scriptSrc: DEFAULT_SCRIPT };
  if (!json) return out;
  try {
    const raw: unknown = JSON.parse(json);
    const a: unknown = raw && typeof raw === 'object' && 'analytics' in raw ? raw.analytics : null;
    if (!a || typeof a !== 'object') return out;
    const get = (k: string): string | undefined => {
      const v: unknown = (a as Record<string, unknown>)[k];
      if (typeof v !== 'string' || !SITE_PATH.test(v)) return undefined;
      return v.startsWith('/') ? v : `/${v}`;
    };
    const script = get('scriptSrc');
    const view = get('viewEndpoint');
    const event = get('eventEndpoint');
    if (script) out.scriptSrc = script;
    if (view) out.viewEndpoint = view;
    if (event) out.eventEndpoint = event;
  } catch {
    // Keep the default.
  }
  return out;
}

/**
 * The URL reported with every page view and event: no hash and no query except `utm_*` campaign tags, so a seed
 * (`?seed=`) or a click id can never leave the page. A visit from a shared link is reported as `<dir>/from-share`.
 * A dare link's path (`/c/<code>`) carries a seed too, so it is always cut back to the folder it is in.
 */
export function cleanUrl(url: string, fromShare: boolean): string {
  try {
    const u = new URL(url);
    const dare = /^(.*\/)c\/[^/]*\/?$/.exec(u.pathname);
    if (dare) u.pathname = dare[1] ?? '/';
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (k.startsWith('utm_')) keep.append(k, v);
    u.search = keep.toString();
    u.hash = '';
    if (fromShare) u.pathname = new URL(FROM_SHARE_PATH, u).pathname;
    return u.href;
  } catch {
    return '';
  }
}

/** The first `max` properties, in order. */
export function trimProps(data: EventData, max = ANALYTICS_MAX_PROPS): EventData {
  return Object.fromEntries(Object.entries(data).slice(0, Math.max(0, max)));
}

type VaFn = (...args: unknown[]) => void;

/** The globals the Vercel script reads: `va` (the call) and `vaq` (calls made before it loaded). */
export interface VaWindow {
  va?: VaFn;
  vaq?: unknown[][];
}

declare global {
  interface Window {
    va?: VaFn;
    vaq?: unknown[][];
  }
}

/** The slice of `document` this needs, so tests can pass a fake. */
export interface ScriptHost {
  createElement(tag: 'script'): HTMLScriptElement;
  head: { appendChild(node: HTMLScriptElement): unknown };
}

interface BeforeSendEvent {
  url: string;
}

/**
 * Queue a `beforeSend` that cleans every URL, add the script tag, and return a tracker for custom events.
 * If anything fails, or the script cannot load (an ad blocker, a host that is not Vercel), tracking turns into a no-op.
 */
export function startWebAnalytics(
  win: VaWindow,
  doc: ScriptHost,
  config: AnalyticsConfig,
  fromShare: boolean,
): Tracker {
  try {
    win.va ??= (...args: unknown[]) => {
      (win.vaq ??= []).push(args);
    };
    win.va('beforeSend', (e: BeforeSendEvent) => {
      const url = cleanUrl(e.url, fromShare);
      return url ? { ...e, url } : null;
    });
    const script = doc.createElement('script');
    script.defer = true;
    script.src = config.scriptSrc;
    script.dataset['sdkn'] = 'powline';
    if (config.viewEndpoint) script.dataset['viewEndpoint'] = config.viewEndpoint;
    if (config.eventEndpoint) script.dataset['eventEndpoint'] = config.eventEndpoint;
    script.onerror = () => {
      win.va = () => {};
      win.vaq = [];
    };
    doc.head.appendChild(script);
  } catch {
    return noTracker;
  }
  return {
    track(event: AnalyticsEvent): void {
      try {
        if ((win.vaq?.length ?? 0) >= MAX_QUEUE) return;
        win.va?.('event', { name: event.name, data: trimProps(event.data) });
      } catch {
        // Analytics must never break the game.
      }
    },
  };
}
