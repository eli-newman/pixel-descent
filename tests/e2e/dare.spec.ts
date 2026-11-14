import type { Page } from '@playwright/test';
import { expect, sentAnalytics, test } from './fixtures';

/** A friend's run: course, score 1240, 312 m, 4 stars, 3 tricks, hit a tree. Riding straight down it crashes. */
const SEED = 'zq7secret42';
const CODE = `${SEED}-1240-312-4-3-t`;

/** Riding straight down the course ends in a tree, which can take a while: allow for it. */
async function expectPhase(page: Page, phase: string): Promise<void> {
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', phase, { timeout: 30_000 });
}

test.describe('dare links', () => {
  test.beforeEach(async ({ page }) => {
    // A returning player, so no tutorial lesson stops the run.
    await page.addInitScript(() => {
      const key = 'pixel-descent:v2:progress';
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ stats: { runs: 3 } }));
    });
  });

  test('preview as the dare: the score to beat, the run, and its card', async ({ request }) => {
    const page = await request.get(`/c/${CODE}`);
    expect(page.status()).toBe(200);
    const html = await page.text();
    expect(html).toContain('<meta property="og:title" content="Beat 1240 on Powline" />');
    expect(html).toContain(`/c/${CODE}/card.png"`);
    expect(html).not.toContain('og.png');

    const card = await request.get(`/c/${CODE}/card.png`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
    // The PNG header's width and height.
    const png = new DataView(new Uint8Array(await card.body()).buffer);
    expect([png.getUint32(16), png.getUint32(20)]).toEqual([1200, 630]);

    expect((await request.get('/c/not-a-dare/card.png')).status()).toBe(404);
  });

  test('open on the course, hide the code, and send the run back as a new dare', async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // No Web Share sheet in a test browser: the link goes to the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
    });

    await page.goto(`/c/${CODE}`);
    await expectPhase(page, 'title');
    // The code (and the seed in it) leaves the address bar and never reaches analytics.
    expect(new URL(page.url()).pathname).toBe('/');
    await expect.poll(async () => (await sentAnalytics(page)).length).toBeGreaterThan(0);
    const [view] = await sentAnalytics(page);
    expect(new URL(view?.url ?? '').pathname).toBe('/from-share');

    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await expectPhase(page, 'over');
    const events = (await sentAnalytics(page)).filter((e) => e.type === 'event');
    expect(events[0]?.payload?.data).toEqual({ run: '1', setup: 'board dare' });
    expect(JSON.stringify(await sentAnalytics(page))).not.toContain(SEED);

    await page.keyboard.press('KeyC');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^\d+ on Powline\. beat it 👇 http:\/\/localhost:\d+\/c\//);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const link = new URL(copied.split(' ').at(-1) ?? '');
    // The new dare is on the same course, with this run's own score.
    expect(link.pathname.startsWith(`/c/${SEED}-`)).toBe(true);
    expect(link.pathname.split('-')[1]).toBe(copied.split(' ')[0]);
    expect((await page.request.get(link.pathname)).status()).toBe(200);
    expect(errors).toEqual([]);
  });

  test('a broken dare link opens the plain game', async ({ page }) => {
    await page.goto('/c/nope');
    await expectPhase(page, 'title');
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
