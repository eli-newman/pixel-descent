import { test as base, type Page } from '@playwright/test';

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

export { expect } from '@playwright/test';

export function sentAnalytics(page: Page): Promise<Sent[]> {
  return page.evaluate(() => (window as unknown as { __vaSent?: Sent[] }).__vaSent ?? []);
}
