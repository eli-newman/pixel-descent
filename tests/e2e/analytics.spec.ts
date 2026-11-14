import {
  ANALYTICS_SCRIPT,
  collectBeacons,
  expect,
  forwardedBatches,
  hidePage,
  pageView,
  sentAnalytics,
  test,
  type Sent,
} from './fixtures';
import { E2E_POSTHOG_KEY } from '../../playwright.config';
import type { BatchBody, BatchEvent } from '../../src/platform/posthog';
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

function posthogEvents(batches: BatchBody[]): BatchEvent[] {
  return batches.flatMap((b) => b.batch);
}

/** Every request the page makes, with its body, to look for the seed in. */
function outgoingRequests(page: Page): string[] {
  const outgoing: string[] = [];
  page.on('request', (r) => {
    if (!r.isNavigationRequest()) outgoing.push(`${r.url()} ${r.postData() ?? ''}`);
  });
  return outgoing;
}

test.describe('analytics', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  // A returning player, past the first-run tutorial: these runs ride straight into a tree with no lesson stopping them.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const key = 'pixel-descent:v2:progress';
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ stats: { runs: 3 } }));
    });
  });

  test('a shared link: from-share page view, two runs and a share to both trackers, with no seed anywhere', async ({
    page,
  }) => {
    // No Web Share sheet in a test browser: take the clipboard and download path.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
    });
    const outgoing = outgoingRequests(page);
    const beacons = collectBeacons(page);

    await page.goto(`/?seed=${SEED}`);
    await expectPhase(page, 'title');
    const view = await pageView(page);
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
      .toContain('Run Shared');
    await againAfterGuard(page);
    await expectPhase(page, 'playing');
    // The run's own dare code, which holds the seed and the exact score.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const code = new URL(copied.split(' ').at(-1) ?? '').pathname.split('/').at(-1) ?? '';
    const [, score, metres] = code.split('-');

    // Vercel: every event, cut to its two most important properties.
    const sent = await sentAnalytics(page);
    const evs = events(sent);
    const MAIN = ['Run Started', 'Run Ended', 'Next Action', 'Run Shared'];
    expect(evs.map((e) => e.name).filter((n) => MAIN.includes(n))).toEqual([
      'Run Started',
      'Run Ended',
      'Next Action',
      'Run Shared',
      'Next Action',
      'Run Started',
    ]);
    expect(evs.slice(0, 2).map((e) => e.name)).toEqual(['Day Active', 'Game Loaded']);
    expect(evs.find((e) => e.name === 'Run Started')?.data).toEqual({
      mode: 'normal',
      kit: 'board',
    });
    expect(evs.find((e) => e.name === 'Run Shared')?.data).toEqual({
      via: 'clipboard',
      mode: 'normal',
    });
    for (const e of evs) expect(Object.keys(e.data).length).toBeLessThanOrEqual(2);
    for (const s of sent) expect(new URL(s.url).pathname).toBe('/from-share');

    // PostHog: a batch for every 10 events, then the rest once the page is hidden.
    expect(beacons.map((b) => b.batch.length)).toEqual(
      Array.from({ length: Math.floor(evs.length / 10) }, () => 10),
    );
    await hidePage(page);
    await expect.poll(() => posthogEvents(beacons).at(-1)?.event).toBe('Session Ended');
    const ph = posthogEvents(beacons);
    expect(ph.map((e) => e.event)).toEqual([...evs.map((e) => e.name), 'Session Ended']);
    expect(beacons.every((b) => b.api_key === E2E_POSTHOG_KEY)).toBe(true);
    const visit = ph[0]?.distinct_id ?? '';
    expect(visit).toMatch(/^[0-9a-f]{32}$/);
    const context = { player: 'returning', days_since_first: '0', source: 'dare' };
    const flags = { $process_person_profile: false, $geoip_disable: true };
    for (const e of ph) {
      expect(e.distinct_id).toBe(visit);
      expect(e.properties).toMatchObject({ ...context, ...flags });
    }
    expect(ph.find((e) => e.event === 'Game Loaded')?.properties).toMatchObject({
      landing: 'old_link',
    });
    expect(ph.find((e) => e.event === 'Run Started')?.properties).toEqual({
      mode: 'normal',
      kit: 'board',
      life_run: '4-5',
      visit_run: '1',
      ...context,
      ...flags,
    });
    expect(ph.find((e) => e.event === 'Run Ended')?.properties).toMatchObject({
      end: 'crash',
      cause: 'tree',
      best: 'new',
      mode: 'normal',
      life_run: '4-5',
    });
    expect(ph.filter((e) => e.event === 'Next Action').map((e) => e.properties['action'])).toEqual([
      'share',
      'again',
    ]);
    expect(ph.find((e) => e.event === 'Session Ended')?.properties).toMatchObject({
      runs: '2',
      length: '<1m',
      resumed: 'no',
    });

    // Never a seed, a dare code, or the exact score or distance.
    const bodies = JSON.stringify(beacons);
    expect(bodies).not.toContain(SEED);
    expect(bodies).not.toContain(code);
    const values = ph.flatMap((e) => Object.values(e.properties).map(String));
    expect(values).not.toContain(score);
    expect(values).not.toContain(metres);
    expect(JSON.stringify(sent)).not.toContain(SEED);
    expect(outgoing.filter((r) => r.includes(SEED))).toEqual([]);
    expect(outgoing.filter((r) => r.includes('posthog'))).toEqual([]);
    expect(page.url()).not.toContain(SEED);

    // The ingest function sent the same events on to (the stand-in) PostHog, without the player's IP.
    await expect
      .poll(
        async () =>
          posthogEvents(await forwardedBatches(page)).filter((e) => e.distinct_id === visit).length,
      )
      .toBe(ph.length);
    const forwarded = posthogEvents(await forwardedBatches(page)).filter(
      (e) => e.distinct_id === visit,
    );
    expect(forwarded.map((e) => e.event)).toEqual(ph.map((e) => e.event));
    for (const e of forwarded) {
      expect(e.properties).toMatchObject(flags);
      expect(e.properties).not.toHaveProperty('$ip');
    }
  });

  test('a run quit from the pause menu still ends, and a direct visit is the plain page', async ({
    page,
  }) => {
    const beacons = collectBeacons(page);
    await page.goto('/?utm_source=test&fbclid=abc');
    const view = await pageView(page);
    const url = new URL(view?.url ?? '');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('?utm_source=test');

    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await page.keyboard.press('Escape');
    await expectPhase(page, 'paused');
    await page.keyboard.press('KeyR');
    await expectPhase(page, 'playing');
    await hidePage(page);
    await expect.poll(() => posthogEvents(beacons).at(-1)?.event).toBe('Session Ended');
    const ph = posthogEvents(beacons);
    expect(ph.map((e) => e.event)).toEqual([
      'Day Active',
      'Game Loaded',
      'Run Started',
      'Run Ended',
      'Run Started',
      'Session Ended',
    ]);
    expect(ph[1]?.properties).toMatchObject({ landing: 'home', source: 'direct' });
    expect(ph[3]?.properties).toMatchObject({ end: 'quit', cause: 'none', life_run: '4-5' });
  });

  test('a blocked script changes nothing for the player', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // Registered last, so it wins over the stand-in: what an ad blocker does.
    await page.route(ANALYTICS_SCRIPT, (route) => route.abort('blockedbyclient'));
    await page.route('**/flurry', (route) => route.abort('blockedbyclient'));
    // A fixed course, so riding straight always ends in a tree: a random one might not within the wait.
    await page.goto(`/?seed=${SEED}`);
    await expectPhase(page, 'title');
    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await expectPhase(page, 'over');
    await hidePage(page);
    await againAfterGuard(page);
    await expectPhase(page, 'playing');
    expect(pageErrors).toEqual([]);
    // The queue was dropped when the script failed, and nothing was sent.
    expect(await page.evaluate(() => (window as unknown as { vaq?: unknown[] }).vaq)).toEqual([]);
  });
});

test.describe('tutorial analytics', () => {
  test("a new player's first lesson, shown and gone on from, on a run labelled tutorial", async ({
    page,
  }) => {
    const beacons = collectBeacons(page);
    await page.goto('/');
    await expectPhase(page, 'title');
    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await expect(page.locator('#stage')).toHaveAttribute('data-lesson', 'on', { timeout: 15_000 });
    // A tap counts only after LESSON_GUARD (1 s).
    await page.waitForTimeout(1200);
    await page.keyboard.press('Space');
    await expect(page.locator('#stage')).toHaveAttribute('data-lesson', 'off');
    await hidePage(page);
    await expect.poll(() => posthogEvents(beacons).at(-1)?.event).toBe('Session Ended');
    const ph = posthogEvents(beacons);
    expect(ph.map((e) => e.event)).toEqual([
      'Day Active',
      'Game Loaded',
      'Run Started',
      'Lesson Shown',
      'Lesson Done',
      'Session Ended',
    ]);
    const context = { player: 'new', days_since_first: '0', source: 'direct' };
    expect(ph[2]?.properties).toMatchObject({ mode: 'tutorial', life_run: '1', ...context });
    expect(ph[3]?.properties).toMatchObject({ lesson: 'steer', tut_run: '1', ...context });
    expect(ph[4]?.properties).toMatchObject({ lesson: 'steer', tut_run: '1' });
  });
});
