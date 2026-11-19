import { expect, test } from './fixtures';

/** The soundtrack's files, which the page must not ask for before the player has done something. */
const TRACK = /\/music\/[a-z0-9-]+\.m4a/;

test.describe('the soundtrack', () => {
  test('is not fetched on load, and starts to stream after the first key press', async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (TRACK.test(r.url())) asked.push(r.url());
    });
    await page.goto('/');
    await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'title');
    // Let the page settle: the title screen is up and nothing has been touched.
    await page.waitForTimeout(1500);
    expect(asked).toEqual([]);

    await page.keyboard.press('Space');
    await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('is not fetched when music is switched off', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (TRACK.test(r.url())) asked.push(r.url());
    });
    await page.addInitScript(() => {
      localStorage.setItem('pixel-descent:v2:settings', JSON.stringify({ music: false }));
    });
    await page.goto('/');
    await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'title');
    await page.keyboard.press('Space');
    await page.waitForTimeout(2000);
    expect(asked).toEqual([]);
  });
});
