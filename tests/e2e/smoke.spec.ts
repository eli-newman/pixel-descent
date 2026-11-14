import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
function readCanvas(
  page: Page,
  layers: readonly string[] = ['#game', '#ui'],
): Promise<{ colours: number; sum: number }> {
  return page.evaluate((ids) => {
    // By default both layers: the slope and the HUD and menus drawn over it.
    const seen = new Set<number>();
    let sum = 0;
    for (const id of ids) {
      const canvas = document.querySelector<HTMLCanvasElement>(id);
      const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return { colours: 0, sum: 0 };
      for (let i = 0; i < data.length; i += 4) {
        const c = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
        seen.add(c);
        sum = (sum * 31 + c) % 1000000007;
      }
    }
    return { colours: seen.size, sum };
  }, layers);
}

async function expectPhase(page: Page, phase: string): Promise<void> {
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', phase);
}

async function expectLesson(page: Page, on: boolean): Promise<void> {
  await expect(page.locator('#stage')).toHaveAttribute('data-lesson', on ? 'on' : 'off');
}

/**
 * A lesson slows the run to a stop (LESSON_EASE_IN in core/config.ts) and takes a tap or Space only once it has been
 * up long enough to read (LESSON_GUARD).
 */
async function afterLessonGuard(page: Page): Promise<void> {
  await page.waitForTimeout(1200);
}

async function expectTitleDrawn(page: Page): Promise<void> {
  await expectPhase(page, 'title');
  expect((await readCanvas(page)).colours).toBeGreaterThan(1);
}

test.describe('desktop', () => {
  test('plays and pauses with the keyboard, after the first-run lesson', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expectTitleDrawn(page);

    // A first visit: the run rides a moment, then slows to a stop on the steering lesson and holds still under it
    // (the slope does; the lesson acts out the keys over it).
    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await expectLesson(page, false);
    await expectLesson(page, true);
    await afterLessonGuard(page);
    const held = await readCanvas(page, ['#game']);
    await page.waitForTimeout(300);
    expect((await readCanvas(page, ['#game'])).sum).toBe(held.sum);
    await page.keyboard.press('Space');
    await expectLesson(page, false);
    const first = await readCanvas(page);
    await expect.poll(async () => (await readCanvas(page)).sum).not.toBe(first.sum);
    // and it is not shown again on the next visit
    await page.reload();
    await expectTitleDrawn(page);
    await page.keyboard.press('Space');
    await expectPhase(page, 'playing');
    await page.waitForTimeout(300);
    await expectLesson(page, false);

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

  test('fills the phone screen edge to edge with the slope', async ({ page }) => {
    await page.goto('/');
    await expectTitleDrawn(page);
    const stage = await page.locator('#stage').boundingBox();
    const slope = await page.locator('#game').boundingBox();
    if (!stage || !slope) throw new Error('No layout');
    // The frame (HUD and taps) is as wide as the screen, and the slope runs past it to the top and bottom edges.
    expect(stage.x).toBe(0);
    expect(stage.width).toBeCloseTo(390, 1);
    expect(slope.y).toBeLessThanOrEqual(0);
    expect(slope.y + slope.height).toBeGreaterThanOrEqual(844);
    // Both canvases are exactly the device pixels they cover, so the browser shows them pixel for pixel and never
    // filters them (Safari's own scaling made the whole game blurry on a phone).
    const backing = await page.evaluate(() =>
      ['#game', '#ui'].map((id) => {
        const c = document.querySelector<HTMLCanvasElement>(id);
        const r = c?.getBoundingClientRect();
        return {
          w: c?.width ?? 0,
          h: c?.height ?? 0,
          cssW: (r?.width ?? 0) * window.devicePixelRatio,
          cssH: (r?.height ?? 0) * window.devicePixelRatio,
          look: c ? getComputedStyle(c).imageRendering : '',
        };
      }),
    );
    for (const b of backing) {
      expect(b.w).toBeCloseTo(b.cssW, 0);
      expect(b.h).toBeCloseTo(b.cssH, 0);
      expect(b.look).toBe('pixelated');
    }
  });

  test('plays and pauses with touch', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expectTitleDrawn(page);

    // The stage is the frame that takes taps: the slope canvas covers the whole screen.
    const box = await page.locator('#stage').boundingBox();
    if (!box) throw new Error('The stage has no box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.touchscreen.tap(
      box.x + (PLAY.x / 180) * box.width,
      box.y + (PLAY.y / 320) * box.height,
    );
    await expectPhase(page, 'playing');
    await expectLesson(page, true);
    await afterLessonGuard(page);
    await page.touchscreen.tap(195, 600);
    await expectLesson(page, false);

    await page.locator('#pause-btn').tap();
    await expectPhase(page, 'paused');

    expect(errors).toEqual([]);
  });
});
