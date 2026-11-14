/**
 * PostHog without the SDK: game events buffered in memory and posted in PostHog's `/batch/` format
 * (https://posthog.com/docs/api/capture) with `navigator.sendBeacon`, or a keep-alive `fetch` where there is no beacon.
 * It goes to a path on this site (`INGEST_PATH`), whose function drops the IP address before PostHog sees the batch.
 *
 * No cookies, nothing stored. `distinct_id` is a random `visit` id made when the page loads, kept in memory only, so
 * PostHog can link one visit's events and nothing more. Every event sets `$process_person_profile: false` (no person
 * profile is kept) and `$geoip_disable: true` (no location is looked up). Nothing here may throw, block or wait: a
 * batch that cannot be sent is dropped.
 */

import { POSTHOG_FLUSH_EVENTS } from '../core/config';
import type { AnalyticsEvent, Tracker } from './analytics';

/** Where events go and the project they belong to, from the build (`vite.config.ts`). */
export interface PostHogConfig {
  /** The project's public API key (`phc_...`). It only lets a client add events, so it may ship in the page. */
  key: string;
  /** A path on this site (`/flurry`), or a full https URL for a page served from elsewhere (an app's web view). */
  endpoint: string;
}

/** PostHog project keys: `phc_` and letters, digits, `_` or `-`. */
const KEY = /^phc_[\w-]{8,100}$/;
/** A path on this site, or an https URL, with no query, hash, `..` or credentials. */
const ENDPOINT = /^(https:\/\/[a-z0-9.-]+(:\d+)?)?(\/[\w-]+)+\/?$/i;

/** The config if both values are sound, else null (PostHog stays off). */
export function posthogConfig(key: string | undefined, endpoint: string): PostHogConfig | null {
  if (!key || !KEY.test(key) || !ENDPOINT.test(endpoint)) return null;
  return { key, endpoint };
}

/** One event as PostHog's batch API takes it. */
export interface BatchEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, string | number | boolean>;
}

/** The body posted to the endpoint: PostHog's `/batch/` payload. */
export interface BatchBody {
  api_key: string;
  batch: BatchEvent[];
}

/** The browser's two ways to send, so tests can pass fakes. Either may be missing. */
export interface Sender {
  sendBeacon?: (url: string, body: string) => boolean;
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
}

export interface PostHogTracker extends Tracker {
  /** Send what is waiting now (the page is being hidden). */
  flush(): void;
}

/** A fresh random id for this page load: 32 hex digits. Never stored. */
export function visitId(fill: (bytes: Uint8Array<ArrayBuffer>) => void): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A tracker that sends to PostHog. Sends once `POSTHOG_FLUSH_EVENTS` are waiting, and on `flush`. Each send is tried
 * once: a beacon, or if the beacon is refused or missing, a keep-alive `fetch` whose failure is ignored.
 */
export function startPostHog(
  config: PostHogConfig,
  sender: Sender,
  visit: string,
  now: () => Date = () => new Date(),
): PostHogTracker {
  let buffer: BatchEvent[] = [];

  function send(body: string): void {
    try {
      if (sender.sendBeacon?.(config.endpoint, body)) return;
    } catch {
      // Fall through to fetch.
    }
    try {
      // text/plain keeps it a simple request (no preflight) for an app's web view posting across origins.
      void sender
        .fetch?.(config.endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'text/plain' },
        })
        .catch(() => {});
    } catch {
      // Dropped.
    }
  }

  function flush(): void {
    if (buffer.length === 0) return;
    const body: BatchBody = { api_key: config.key, batch: buffer };
    buffer = [];
    try {
      send(JSON.stringify(body));
    } catch {
      // Dropped.
    }
  }

  return {
    track(e: AnalyticsEvent): void {
      try {
        buffer.push({
          event: e.name,
          distinct_id: visit,
          timestamp: now().toISOString(),
          properties: { ...e.data, $process_person_profile: false, $geoip_disable: true },
        });
        if (buffer.length >= POSTHOG_FLUSH_EVENTS) flush();
      } catch {
        // Analytics must never break the game.
      }
    },
    flush,
  };
}

/** Send every event to each tracker in turn: Vercel and PostHog. */
export function fanOut(...trackers: Tracker[]): Tracker {
  return {
    track(e: AnalyticsEvent): void {
      for (const t of trackers) {
        try {
          t.track(e);
        } catch {
          // One tracker failing never stops the next.
        }
      }
    },
  };
}
