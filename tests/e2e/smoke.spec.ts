import { expect, test, type Page } from '@playwright/test';

/** Logical position of the PLAY button on the 180x320 canvas (see TITLE in src/state/menu.ts). */
const PLAY = { x: 90, y: 185 };

/** Collects every uncaught error and console.error, so a test can assert there were none. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** How many distinct colours the canvas shows and a checksum, so "blank" and "frozen" can both be detected. */
function readCanvas(page: Page): Promise<{ colours: number; sum: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game');
    const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) return { colours: 0, sum: 0 };
    const seen = new Set<number>();
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const c = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      seen.add(c);
      sum = (sum * 31 + c) % 1000000007;
    }
    return { colours: seen.size, sum };
  });
}

async function expectPhase(page: Page, phase: string): Promise<void> {
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', phase);
}

async function expectTitleDrawn(page: Page): Promise<void> {
  await expectPhase(page, 'title');
  expect((await readCanvas(page)).colours).toBeGreaterThan(1);
}

test.describe('desktop', () => {
  test('plays and pauses with the keyboard', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expectTitleDrawn(page);

    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    const first = await readCanvas(page);
    await expect.poll(async () => (await readCanvas(page)).sum).not.toBe(first.sum);

    await page.keyboard.press('KeyP');
    await expectPhase(page, 'paused');
    await page.keyboard.press('KeyP');
    await expectPhase(page, 'playing');

    expect(errors).toEqual([]);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('keeps its size when the page is zoomed', async ({ page }) => {
    await page.goto('/');
    await expectTitleDrawn(page);
    const before = await page.locator('#stage').boundingBox();

    // iOS Safari reports the zoomed area here. Chromium does not, so stand in for it.
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerWidth', { value: 350 });
      Object.defineProperty(window, 'innerHeight', { value: 620 });
      window.dispatchEvent(new Event('resize'));
    });

    expect(await page.locator('#stage').boundingBox()).toEqual(before);
  });

  test('plays and pauses with touch', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expectTitleDrawn(page);

    const box = await page.locator('#game').boundingBox();
    if (!box) throw new Error('The canvas has no box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.touchscreen.tap(
      box.x + (PLAY.x / 180) * box.width,
      box.y + (PLAY.y / 320) * box.height,
    );
    await expectPhase(page, 'playing');

    await page.locator('#pause-btn').tap();
    await expectPhase(page, 'paused');

    expect(errors).toEqual([]);
  });
});
