/**
 * Serves `.vercel/output` (written by `scripts/vercel-output.mjs`) on localhost the way Vercel routes it: the
 * `config.json` routes first, into the bundled functions, then the static files. The browser tests run against this,
 * so they test the same layout that gets deployed, dare links and their preview cards included.
 *
 * Usage: node scripts/serve-output.mjs [port]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = fileURLToPath(new URL('../.vercel/output/', import.meta.url));
const port = Number(process.argv[2] ?? 4179);
const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};
const handlers = new Map();

async function handler(name) {
  if (!handlers.has(name)) {
    const file = pathToFileURL(join(out, 'functions', `${name}.func`, 'index.mjs')).href;
    handlers.set(name, (await import(file)).default);
  }
  return handlers.get(name);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  for (const route of config.routes) {
    if (route.handle) break;
    const m = new RegExp(route.src).exec(url.pathname);
    if (!m) continue;
    const dest = new URL(
      route.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ''),
      url,
    );
    req.url = dest.pathname + dest.search;
    req.headers['x-forwarded-proto'] = 'http';
    return (await handler(dest.pathname.slice(1)))(req, res);
  }
  let file = normalize(join(out, 'static', decodeURIComponent(url.pathname)));
  if (!file.startsWith(join(out, 'static'))) file = '';
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file || !existsSync(file)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Serving .vercel/output on http://localhost:${port}/`));
