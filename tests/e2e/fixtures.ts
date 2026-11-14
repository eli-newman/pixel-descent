import { expect, test as base, type Page } from '@playwright/test';
import { INGEST_PATH } from '../../src/core/config';
import type { BatchBody } from '../../src/platform/posthog';

/** What the stand-in Vercel script recorded: each page view or event after the game's `beforeSend`. */
export interface Sent {
  type: 'pageview' | 'event';
  url: string;
  payload?: { name: string; data?: Record<string, unknown> };
}

/**
 * Stands in for Vercel's script, which only exists on a Vercel deployment: the same contract (drain `vaq`, apply
 * `beforeSend`, then count a page view), but it records into `window.__vaSent` and sends nothing.
 */
const STUB = `(() => {
  const sent = (window.__vaSent = []);
  let before = (e) => e;
  const send = (type, payload) => {
    const e = before({ type, url: location.href, payload });
    if (e) sent.push(e);
  };
  window.va = (cmd, arg) => {
    if (cmd === 'beforeSend') before = arg;
    else if (cmd === 'event') send('event', arg);
  };
  for (const [cmd, arg] of window.vaq || []) window.va(cmd, arg);
  window.vaq = [];
  send('pageview');
})();`;

export const ANALYTICS_SCRIPT = '**/_vercel/insights/script.js';

/** Every page gets the stand-in script, so the bundle (built with analytics on, like on Vercel) loads cleanly. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(ANALYTICS_SCRIPT, (route) =>
      route.fulfill({ contentType: 'text/javascript', body: STUB }),
    );
    await use(page);
  },
});

export { expect };

export function sentAnalytics(page: Page): Promise<Sent[]> {
  return page.evaluate(() => (window as unknown as { __vaSent?: Sent[] }).__vaSent ?? []);
}

/**
 * The page view, once the stand-in script has sent it. Game events queued while the script loaded (Day Active, Game
 * Loaded) may come before it.
 */
export async function pageView(page: Page): Promise<Sent | undefined> {
  const find = async () => (await sentAnalytics(page)).find((s) => s.type === 'pageview');
  await expect.poll(find).toBeDefined();
  return find();
}

/**
 * Every batch the page posts to the ingest route (`platform/posthog.ts`), as the browser sent it. Start collecting
 * before the page loads.
 */
export function collectBeacons(page: Page): BatchBody[] {
  const out: BatchBody[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST' || new URL(r.url()).pathname !== `/${INGEST_PATH}`) return;
    try {
      out.push(JSON.parse(r.postData() ?? '') as BatchBody);
    } catch {
      out.push({ api_key: 'unreadable', batch: [] });
    }
  });
  return out;
}

/** What the ingest function sent on to the stand-in PostHog in `scripts/serve-output.mjs`, from every test so far. */
export async function forwardedBatches(page: Page): Promise<BatchBody[]> {
  return (await (await page.request.get('/__posthog/batches')).json()) as BatchBody[];
}

/** Act as if the player switched away: the page reports hidden and fires `visibilitychange`, which sends the batch. */
export async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
