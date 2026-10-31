import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { COURSE_PX, ExactHasher, hashCourses, type CourseHash } from './courseHash';

/** 50 random-style seeds, plus daily seeds, which everyone in the world plays together. */
const SEEDS = [
  ...Array.from({ length: 50 }, (_, i) => `k${(i * 7919).toString(36)}q`),
  ...Array.from({ length: 12 }, (_, m) => `d2026${String(m + 1).padStart(2, '0')}15`),
];

/** Bundle the real course code for the page, so production never needs a test hook. */
async function bundleCourseCode(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: decodeURIComponent(new URL('./courseHash.ts', import.meta.url).pathname),
        formats: ['iife'],
        name: 'CourseCode',
      },
    },
  });
  if (!('output' in output) && !Array.isArray(output)) throw new Error('Expected a bundle');
  const chunk = (Array.isArray(output) ? output[0] : output)?.output[0];
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected a code chunk');
  return chunk.code;
}

test('a one-bit difference changes the hash', () => {
  const hash = (v: number): string => {
    const hasher = new ExactHasher();
    hasher.add(v);
    return hasher.hex;
  };
  expect(hash(1 + Number.EPSILON)).not.toBe(hash(1));
});

test('whole courses are bit-identical to node', async ({ page, browser, browserName }) => {
  test.setTimeout(180_000);
  const expected = hashCourses(SEEDS);
  await page.addScriptTag({ content: await bundleCourseCode() });
  const actual = await page.evaluate((seeds) => {
    const code = (window as unknown as { CourseCode: { hashCourses: typeof hashCourses } })
      .CourseCode;
    return code.hashCourses(seeds);
  }, SEEDS);

  expect(actual).toEqual(expected);
  expect(new Set(actual.map((c: CourseHash) => c.hash)).size).toBe(SEEDS.length);
  const objects = actual.reduce((sum: number, c: CourseHash) => sum + c.objects, 0);
  expect(objects).toBeGreaterThan(SEEDS.length * 1000);
  console.log(
    `${browserName} ${browser.version()}: ${SEEDS.length} seeds, ${COURSE_PX / 8} m each, ${objects} objects, all match node`,
  );
});
