import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Dare } from '../src/core/dare';
import cardHandler from '../src/server/cardHandler';
import { cardPng } from '../src/server/card';
import type { Req, Res } from '../src/server/http';
import { originOf } from '../src/server/http';
import { darePage } from '../src/server/page';
import pageHandler from '../src/server/pageHandler';
import { crc32, encodePng } from '../src/server/png';

const DARE: Dare = {
  seed: 'k3m9qa',
  score: 1240,
  dist: 312,
  stars: 4,
  tricks: 3,
  end: 'tree',
  skis: false,
};
const CODE = 'k3m9qa-1240-312-4-3-t';

/** A trimmed copy of the built index.html: relative assets, the site's own preview tags. */
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta property="og:title" content="Powline" />
    <meta
      property="og:image"
      content="https://powline.vercel.app/og.png"
    />
    <meta name="twitter:card" content="summary_large_image" />
    <title>Powline</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body></body>
</html>`;

/** The chunks of a PNG, checking each one's CRC. */
function chunks(png: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = new Map<string, Uint8Array>();
  let at = 8;
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    expect(view.getUint32(at + 8 + len)).toBe(crc32(png.subarray(at + 4, at + 8 + len)));
    out.set(type, png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return out;
}

class FakeRes implements Res {
  statusCode = 0;
  headers: Record<string, string | number> = {};
  body: string | Uint8Array | undefined;
  setHeader(name: string, value: string | number): void {
    this.headers[name.toLowerCase()] = value;
  }
  end(body?: string | Uint8Array): void {
    this.body = body;
  }
}

function req(url: string, headers: Req['headers'] = { host: 'powline.vercel.app' }): Req {
  return { url, headers };
}

describe('PNG', () => {
  it('encodes a valid opaque RGB image that unpacks to the same pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255]);
    const parts = chunks(encodePng(2, 2, rgba));
    const ihdr = parts.get('IHDR') ?? new Uint8Array();
    const hv = new DataView(ihdr.buffer, ihdr.byteOffset);
    expect([hv.getUint32(0), hv.getUint32(4), ihdr[8], ihdr[9]]).toEqual([2, 2, 8, 2]);
    const raw = inflateSync(parts.get('IDAT') ?? new Uint8Array());
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 8, 7]);
    expect(parts.has('IEND')).toBe(true);
  });

  it('draws the dare card at link preview size, small enough to send', () => {
    const png = cardPng(DARE);
    const ihdr = chunks(png).get('IHDR') ?? new Uint8Array();
    const hv = new DataView(ihdr.buffer, ihdr.byteOffset);
    expect([hv.getUint32(0), hv.getUint32(4)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(40_000);
  });
});

describe('dare page', () => {
  const html = darePage(INDEX, DARE, 'https://powline.vercel.app');

  it("swaps the site's preview for the dare's: score to beat, the run, and its card", () => {
    expect(html).not.toContain('og.png');
    expect(html.match(/og:title/g)?.length).toBe(1);
    expect(html).toContain('<meta property="og:title" content="Beat 1240 on Powline" />');
    expect(html).toContain(
      'content="312m, 4 stars, 3 tricks, then wiped out on a tree. Same course, your turn."',
    );
    expect(html).toContain(`content="https://powline.vercel.app/c/${CODE}/card.png"`);
    expect(html).toContain(
      `<meta property="og:url" content="https://powline.vercel.app/c/${CODE}" />`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("keeps the game working from the dare's path", () => {
    expect(html).toContain('<base href="/" />');
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('./assets/'));
    expect(html).toContain('src="./assets/index-abc.js"');
  });

  it('says one star and one trick, and names a daily course', () => {
    const one = darePage(
      INDEX,
      { ...DARE, stars: 1, tricks: 1, seed: 'd20261113' },
      'https://x.app',
    );
    expect(one).toContain('Beat 1240 on today&#39;s Powline');
    expect(one).toContain('312m, 1 star, 1 trick, then');
  });
});

describe('handlers', () => {
  it('serve the dare page, and send a bad code to the plain game', () => {
    (globalThis as { __INDEX_HTML__?: string }).__INDEX_HTML__ = INDEX;
    const ok = new FakeRes();
    pageHandler(req(`/dare?code=${CODE}`), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(String(ok.body)).toContain('Beat 1240 on Powline');
    const bad = new FakeRes();
    pageHandler(req('/dare?code=nope'), bad);
    expect(bad.statusCode).toBe(302);
    expect(bad.headers['location']).toBe('/');
  });

  it('serve the card as a PNG, and nothing for a bad code', () => {
    const ok = new FakeRes();
    cardHandler(req(`/dare-card?code=${CODE}`), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.body).toEqual(cardPng(DARE));
    const bad = new FakeRes();
    cardHandler(req('/dare-card'), bad);
    expect(bad.statusCode).toBe(404);
  });

  it('build absolute preview URLs from the host Vercel forwards', () => {
    expect(
      originOf(
        req('/', { 'x-forwarded-host': 'powline.vercel.app', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://powline.vercel.app');
    expect(originOf(req('/', { host: 'localhost:4179', 'x-forwarded-proto': 'http' }))).toBe(
      'http://localhost:4179',
    );
  });
});
