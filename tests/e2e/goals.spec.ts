import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The GOALS button on the title (see TITLE in src/state/menu.ts), in logical pixels of the 180x320 frame. */
const GOALS = { x: 48, y: 265 };

/** What the HUD layer shows in a band of logical rows: how many pixels are lit, which of them yellow, and how wide. */
async function band(
  page: Page,
  y0: number,
  y1: number,
): Promise<{ lit: number; hot: number; x0: number; x1: number }> {
  return page.evaluate(
    ([top, bottom]) => {
      const c = document.querySelector<HTMLCanvasElement>('#ui');
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return { lit: 0, hot: 0, x0: 0, x1: 0 };
      const k = c.height / 320;
      const ya = Math.floor(top * k);
      const data = ctx.getImageData(0, ya, c.width, Math.ceil(bottom * k) - ya).data;
      let lit = 0;
      let hot = 0;
      let x0 = Infinity;
      let x1 = -1;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
        if (a < 128 || r + g + b < 200) continue;
        lit++;
        if (r > 200 && g > 180 && b < 120) hot++;
        const x = (i / 4) % c.width;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
      return { lit, hot, x0: x0 / k, x1: x1 / k };
    },
    [y0, y1] as const,
  );
}

/** A returning player whose save says `streak` days, the last one today on this device's clock. */
async function returning(page: Page, streak: number): Promise<void> {
  await page.addInitScript((n) => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stats = {
      runs: 9,
      lessons: 31,
      lastDay: n > 0 ? day : '',
      streak: n,
      bestStreak: Math.max(n, 5),
    };
    localStorage.setItem(
      'pixel-descent:v2:progress',
      JSON.stringify({ stats, goals: { day, values: [1, 1, 1], days: 2 } }),
    );
  }, streak);
}

async function frame(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('The stage has no box');
  return box;
}

test.describe('daily streak and goals on a phone', () => {
  test.use({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test('the title shows a streak quietly beside today’s best, only once there is one', async ({
    page,
  }) => {
    await returning(page, 1);
    await page.goto('/');
    await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'title');
    const plain = await band(page, 283, 290);
    await page.close();

    const streaky = await page.context().newPage();
    await returning(streaky, 4);
    await streaky.goto('/');
    await expect(streaky.locator('#stage')).toHaveAttribute('data-phase', 'title');
    const line = await band(streaky, 283, 290);
    // The same white line, longer by "  4 DAY STREAK", and still inside the frame.
    expect(line.hot).toBe(0);
    expect(line.lit).toBeGreaterThan(plain.lit);
    expect(line.x1 - line.x0).toBeGreaterThan(plain.x1 - plain.x0 + 40);
    expect(line.x0).toBeGreaterThan(4);
    expect(line.x1).toBeLessThan(176);
  });

  test('GOALS shows today’s three goals, the challenges and the achievements, and it all fits', async ({
    page,
  }) => {
    await returning(page, 4);
    await page.goto('/');
    await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'title');
    const box = await frame(page);
    await page.touchscreen.tap(
      box.x + (GOALS.x / 180) * box.width,
      box.y + (GOALS.y / 320) * box.height,
    );
    await expect(page.locator('#stage')).toHaveAttribute('data-screen', 'goals');
    // TODAY in yellow on the left, the streak in white on the right.
    const today = await band(page, 32, 38);
    expect(today.hot).toBeGreaterThan(0);
    expect(today.x1).toBeGreaterThan(150);
    // Three goals, each a name over a bar across the screen, with the challenges under them.
    for (let i = 0; i < 3; i++) {
      const bar = await band(page, 52 + i * 18, 57 + i * 18);
      expect(bar.x0).toBeLessThan(17);
      expect(bar.x1).toBeGreaterThan(163);
    }
    expect((await band(page, 102, 108)).hot).toBeGreaterThan(0);
    expect((await band(page, 190, 196)).hot).toBeGreaterThan(0);
    // Nothing drawn runs off the sides or into BACK.
    const all = await band(page, 0, 284);
    expect(all.x0).toBeGreaterThanOrEqual(4);
    expect(all.x1).toBeLessThanOrEqual(176);
    expect((await band(page, 277, 284)).lit).toBe(0);
  });
});
