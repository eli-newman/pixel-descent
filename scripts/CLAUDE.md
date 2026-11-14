# scripts

Node scripts for building and serving the deployment. Not part of the game, never bundled into it.

| File                | Job                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vercel-output.mjs` | Last step of `npm run build`: writes `.vercel/output` (Vercel's Build Output API layout): `static/` is `dist/`, `functions/dare.func` and `functions/dare-card.func` are `src/server/pageHandler.ts` and `cardHandler.ts` bundled by Vite into one `index.mjs` each (Node 22, the built `index.html` baked in), and `config.json` routes `/c/<code>` and `/c/<code>/card.png` to them before the static files. |
| `serve-output.mjs`  | `node scripts/serve-output.mjs [port]`: serves `.vercel/output` on localhost, following its `config.json` routes into the bundled functions, then the static files. The browser tests (`playwright.config.ts`) run against it.                                                                                                                                                                                 |

## Rules

- Plain ES modules for Node, linted without type information (`eslint.config.js`).
- A new function or route goes in `vercel-output.mjs`; `serve-output.mjs` follows `config.json`, so it needs no change unless a route uses a feature it does not handle (it knows `src`, `dest` with `$1` captures, and `handle: 'filesystem'`).

## Keeping docs in sync (mandatory)

When you change a script, update this file, and the root `CLAUDE.md` if the build or deploy changes.
