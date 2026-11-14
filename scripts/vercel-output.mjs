/**
 * Writes the deployment Vercel serves, in its Build Output API layout (`.vercel/output`), after `vite build` has made
 * `dist/`. Vercel uses this folder as it is when a build leaves one behind:
 *
 * - `static/`: the game, exactly `dist/`.
 * - `functions/dare.func`: `/c/<code>`, the game's page with a dare's link preview (`src/server/pageHandler.ts`).
 * - `functions/dare-card.func`: `/c/<code>/card.png`, the dare's card image (`src/server/cardHandler.ts`).
 * - `functions/ingest.func`: `POST /<INGEST_PATH>`, game events passed on to PostHog without the player's IP
 *   (`src/server/ingestHandler.ts`), with the project key from `VITE_POSTHOG_KEY` baked in ('' drops every event).
 *
 * Each function is bundled into one file here, with the built `index.html` baked in, so nothing at runtime depends on
 * how Vercel would compile TypeScript or resolve the source's extensionless imports.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const indexHtml = readFileSync(`${root}dist/index.html`, 'utf8');
/** The ingest route's path lives with the game's other settings, so the page and the route always agree. */
const { INGEST_PATH } = (await runnerImport(`${root}src/core/config.ts`)).module;
const posthogKey = (process.env.VITE_POSTHOG_KEY ?? '').trim();

// `helpers: false` gives the ingest function Node's plain request, whose body it reads itself.
const FUNCTIONS = [
  { name: 'dare', entry: 'src/server/pageHandler.ts', helpers: true },
  { name: 'dare-card', entry: 'src/server/cardHandler.ts', helpers: true },
  { name: 'ingest', entry: 'src/server/ingestHandler.ts', helpers: false },
];

rmSync(out, { recursive: true, force: true });
cpSync(`${root}dist`, `${out}/static`, { recursive: true });

for (const fn of FUNCTIONS) {
  const dir = `${out}/functions/${fn.name}.func`;
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define: {
      __INDEX_HTML__: JSON.stringify(indexHtml),
      __POSTHOG_KEY__: JSON.stringify(posthogKey),
    },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: fn.entry,
      outDir: dir,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } },
    },
  });
  writeFileSync(`${dir}/package.json`, JSON.stringify({ type: 'module' }));
  writeFileSync(
    `${dir}/.vc-config.json`,
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: fn.helpers,
      },
      null,
      2,
    ),
  );
}

mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/c/([^/]+)/card\\.png$', dest: '/dare-card?code=$1' },
        { src: '^/c/([^/]+)/?$', dest: '/dare?code=$1' },
        { src: `^/${INGEST_PATH}/?$`, dest: '/ingest' },
        { handle: 'filesystem' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Wrote ${out} (static game, ${FUNCTIONS.map((f) => f.name).join(', ')})`);
