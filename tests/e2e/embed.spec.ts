import { expect, test } from '@playwright/test';
import { build } from 'vite';

/** Build the embed exactly as `npm run build:embed` does, in memory, and return the shipped ES module. */
async function bundleEmbed(): Promise<{ js: string; dts: string }> {
  const output = await build({
    configFile: decodeURIComponent(new URL('../../vite.embed.config.ts', import.meta.url).pathname),
    logLevel: 'silent',
    build: { write: false },
  });
  const bundle = Array.isArray(output) ? output[0] : output;
  if (!bundle || !('output' in bundle)) throw new Error('Expected a bundle');
  const js = bundle.output.find((o) => o.fileName === 'powline-embed.js');
  const dts = bundle.output.find((o) => o.fileName === 'powline-embed.d.ts');
  if (js?.type !== 'chunk' || dts?.type !== 'asset')
    throw new Error('Expected the module and its types');
  return { js: js.code, dts: String(dts.source) };
}

test('the embed bundle imports on its own and composites over a black page', async ({ page }) => {
  const { js, dts } = await bundleEmbed();
  expect(js).not.toMatch(/\bimport\b[^(]/);
  expect(dts).not.toMatch(/^\s*import\s/m);
  await page.setContent('<body style="margin:0;background:#000"><canvas></canvas></body>');
  const result = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const E = (await import(url)) as typeof import('../../src/embed/index');
    const s = E.createSurface(180, 240);
    const track = new E.EmbedTrack();
    for (let y = 10; y < 200; y += 2) {
      const heading = 0.8 * Math.sin(y / 25);
      track.add({ x: 90 + 30 * Math.sin(y / 40), y, heading, edge: Math.sign(heading), air: 0 });
    }
    track.draw(s);
    E.drawSpray(s, { x: 100, y: 120 }, 0.5, 1, 0.3, 1);
    E.drawRider(s, {
      x: 90,
      y: 200,
      heading: 0.3,
      edge: -1,
      air: 14,
      pitch: 1,
      spin: 0,
      crouch: 0,
    });
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('no canvas');
    canvas.width = s.width;
    canvas.height = s.height;
    ctx.putImageData(new ImageData(s.data, s.width, s.height), 0, 0);
    const back = ctx.getImageData(0, 0, s.width, s.height).data;
    let opaque = 0;
    let clear = 0;
    let same = true;
    for (let i = 0; i < back.length; i += 4) {
      if (back[i + 3] === 255) opaque++;
      else if (back[i + 3] === 0) clear++;
      if (back[i] !== s.data[i] || back[i + 3] !== s.data[i + 3]) same = false;
    }
    return { opaque, clear, same, palette: E.EMBED_PALETTE };
  }, js);
  expect(result.same).toBe(true);
  expect(result.opaque).toBeGreaterThan(300);
  expect(result.opaque + result.clear).toBe(180 * 240);
  expect(result.palette.yellow).toBe('#f5d742');
});
