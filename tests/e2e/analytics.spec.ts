import { ANALYTICS_SCRIPT, expect, sentAnalytics, test, type Sent } from './fixtures';
import type { Page } from '@playwright/test';

/** A seed only a shared link would carry. It must never show up in anything analytics sends. */
const SEED = 'zq7secret42';

async function expectPhase(page: Page, phase: string): Promise<void> {
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', phase, { timeout: 30_000 });
}

/** The game over panel ignores a restart for its first half second (RESTART_GUARD in src/state/game.ts). */
async function againAfterGuard(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
}

function events(sent: Sent[]): { name: string; data: Record<string, unknown> }[] {
  return sent
    .filter((s) => s.type === 'event')
    .map((s) => ({ name: s.payload?.name ?? '', data: s.payload?.data ?? {} }));
}

test.describe('analytics', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a shared link: from-share page view, two runs and a share, with no seed anywhere', async ({
    page,
  }) => {
    // No Web Share sheet in a test browser: take the clipboard and download path.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
    });
    const outgoing: string[] = [];
    page.on('request', (r) => {
      if (!r.isNavigationRequest()) outgoing.push(`${r.url()} ${r.postData() ?? ''}`);
    });

    await page.goto(`/?seed=${SEED}`);
    await expectPhase(page, 'title');
    await expect.poll(async () => (await sentAnalytics(page)).length).toBeGreaterThan(0);
    const [view] = await sentAnalytics(page);
    expect(view?.type).toBe('pageview');
    expect(new URL(view?.url ?? '').pathname).toBe('/from-share');

    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    // Riding straight down this course ends in a tree within a few seconds.
    await expectPhase(page, 'over');
    const download = page.waitForEvent('download');
    await page.keyboard.press('KeyC');
    await download;
    await expect
      .poll(async () => events(await sentAnalytics(page)).map((e) => e.name))
      .toEqual(['Run Start', 'Run End', 'Share']);
    await againAfterGuard(page);
    await expectPhase(page, 'playing');

    const sent = await sentAnalytics(page);
    const evs = events(sent);
    expect(evs.map((e) => e.name)).toEqual(['Run Start', 'Run End', 'Share', 'Run Start']);
    expect(evs[0]?.data).toEqual({ run: '1', setup: 'board mono normal' });
    expect(Object.keys(evs[1]?.data ?? {})).toEqual(['metres', 'score']);
    expect(evs[2]?.data).toEqual({ via: 'clipboard' });
    expect(evs[3]?.data).toEqual({ run: '2', setup: 'board mono normal' });
    for (const s of sent) expect(new URL(s.url).pathname).toBe('/from-share');

    expect(JSON.stringify(sent)).not.toContain(SEED);
    expect(outgoing.filter((r) => r.includes(SEED))).toEqual([]);
    expect(page.url()).not.toContain(SEED);
  });

  test('a direct visit is the plain page', async ({ page }) => {
    await page.goto('/?utm_source=test&fbclid=abc');
    await expect.poll(async () => (await sentAnalytics(page)).length).toBeGreaterThan(0);
    const [view] = await sentAnalytics(page);
    const url = new URL(view?.url ?? '');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('?utm_source=test');
  });

  test('a blocked script changes nothing for the player', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // Registered last, so it wins over the stand-in: what an ad blocker does.
    await page.route(ANALYTICS_SCRIPT, (route) => route.abort('blockedbyclient'));
    // A fixed course, so riding straight always ends in a tree: a random one might not within the wait.
    await page.goto(`/?seed=${SEED}`);
    await expectPhase(page, 'title');
    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await expectPhase(page, 'over');
    await againAfterGuard(page);
    await expectPhase(page, 'playing');
    expect(pageErrors).toEqual([]);
    // The queue was dropped when the script failed, and nothing was sent.
    expect(await page.evaluate(() => (window as unknown as { vaq?: unknown[] }).vaq)).toEqual([]);
  });
});
