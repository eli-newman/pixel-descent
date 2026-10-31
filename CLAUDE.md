# Fall Line

Black and white pixel-art downhill snowboard game, with one yellow UI accent and two greys for the track shadow. TypeScript + Vite, a 180x320 canvas drawn into an RGBA framebuffer, no runtime dependencies. See `README.md` for gameplay and controls.

## Commands

```
npm run dev         # http://localhost:5173
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run (tests/)
npm run check       # typecheck + lint + format check + vitest
npm run test:e2e    # Playwright smoke test against the production bundle (tests/e2e)
npm run build       # typecheck + vitest + vite build, so a deploy cannot ship failing tests
npm run format      # prettier
```

Before calling any change done: `npm run check`, `npm run build` and `npm run test:e2e` must all pass. CI (`.github/workflows/ci.yml`) runs the same steps on every push and pull request to `main`. First-time e2e setup: `npx playwright install chromium`.

## Hosting and deploy

Hosted on Vercel, project `pixel-descent` (team "Eli's projects", Vite preset, linked locally through `.vercel/`, which is git-ignored). Live at https://pixel-descent.vercel.app. The code is on GitHub at `eli-newman/pixel-descent`.

The Vercel project is connected to GitHub: pushing a branch builds a preview deployment (confirmed on PR #1). Merging to `main` is therefore expected to deploy to production, so treat a merge as a release. Earlier production deploys were made from the CLI (`vercel --prod`). Check `vercel ls` after merging. The build uses relative URLs (`base: './'`) and Vercel runs `npm run build`.

## Dependencies

`package.json` overrides `minimatch` to `^11.0.3` because the versions eslint and typescript-eslint ask for are flagged by `npm audit` (GHSA-g3hv-75wg-m249). Drop the override once they require a patched version themselves.

## Layout and dependency rules

```
src/
  main.ts       entry: builds every object once, starts the loop
  core/         constants and seeded RNG. Imports no other folder.
  sim/          pure deterministic rules. Imports core only.
  state/        game state machine, controls, feedback, progress, persistence, the read-only view. Imports sim and core; types only from platform and render.
  platform/     browser I/O (input, audio, loop, viewport, share sheet). Imports core, render/share and render/framebuffer.
  render/       draws state to the framebuffer. Imports sim, state and core.
tests/          vitest, one file per feature, helpers/ for fakes and a bot, e2e/ for the Playwright smoke test
```

`main.ts` may import everything, and nothing imports `main.ts`. These rules are enforced by `npm run lint` (the `boundaries` entries in `eslint.config.js`): change them there and here together.

Note that `render/` imports `state/` at runtime (button layout, gear data) and that `state/` only imports `render/` types, so the runtime dependency has one direction.

- `sim/` and `core/` must never touch the DOM, `window`, `localStorage`, audio or `render/`. This is what keeps seeds, replays and tests deterministic.
- `render/` must not change game state. It sees only `GameView` and `SimView` (`src/state/view.ts`), so writing to them or calling a mutating method is a compile error, and boundary lint stops `render/` importing `state/game` or `sim/sim`, even as types. Lint backs this up in `src/render/**`: no `as` casts (except `as const`), type assertions, `!` or ts-comments, and every parameter must be read-only (except `Framebuffer`, `Mask`, `Rng`). Not caught: assigning a view object to a local or array annotated with a mutable type, since TypeScript allows it and no lint rule covers it.
- Do not add a new top-level folder in `src/` without updating this file.
- Tunable numbers and feature switches go in `src/core/config.ts`.

## Documentation rule (mandatory)

Every folder has its own `CLAUDE.md`. Whenever you add, remove, rename or change the behavior of a file, a constant, an exported function or a rule in the game, you MUST update, in the same change:

1. the `CLAUDE.md` in that file's folder (file table, rules, gotchas),
2. this root `CLAUDE.md` if the layout or dependency rules changed,
3. `README.md` if player-facing behavior or file paths changed.

A change is not finished until the docs match the code.

## Folder docs

- `src/core/CLAUDE.md`
- `src/sim/CLAUDE.md`
- `src/state/CLAUDE.md`
- `src/platform/CLAUDE.md`
- `src/render/CLAUDE.md`
- `tests/CLAUDE.md`

## Conventions

- Match the surrounding code: comment density, naming, idiom. Prettier formats everything.
- No em dashes in any text, use a plain dash.
- Removed features live in `archive/*` git tags (checkpoints, path-stars, ghost, avalanche), not behind flags in the code. Do not add dead code behind a flag.
- Seeds are internal. Never show one to the player or make them think about one: scores are all-time or today's daily, and `GameView` does not expose a seed. Share links carry one, and `main.ts` clears it from the address bar on load.
- The game has one calm look on every device, so phone and desktop match. Shake, zoom punch and snowfall were deleted, not switched off.
