# src/embed

A library for other pages (Eli's personal site): the game's real rider, air shadow, carved track and powder, drawn into a transparent RGBA `Surface` that the page composites over its own content. Built by `npm run build:embed` (`vite.embed.config.ts`) into `dist-embed/powline-embed.js` (one dependency-free ES module) and `dist-embed/powline-embed.d.ts` (one self-contained declaration file). The site vendors those two files by copying them, so rebuild and recopy after any change here.

| File        | Job                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`  | The public API, and the only entry: `createSurface`, `clearSurface`, `drawRider` (via `sim/pose.boardPose` and `render/riderSprite`), `EmbedTrack` (via `render/track.TrackPainter`), `drawSpray`, `drawLanding`, `EMBED_PALETTE` and constants. |
| `flecks.ts` | Closed-form powder bursts: the game's particle jet (`state/effects.ts`) solved for any age, so a burst can be drawn at any time with no state.                                                                                                   |

## Conventions of the API

- Art pixels of the surface. `EmbedPose.x`/`y` and `EmbedTrack.add` points are the board centre; the game works from the tail, so the embed converts (tail = centre - half a board along the heading).
- `heading` 0 points down the page (+y), positive turns toward +x. Like the game, heading toward +x is ridden heelside and toward -x toeside; `edge` only picks the stance within 0.05 of the fall line, and its size deepens the lean. Spray goes to the outside: toeside (edge > 0) throws toward +x when heading straight down.
- Pitch and spin are radians. Positive pitch is the game's backflip in code terms.
- Untouched pixels stay alpha 0. Everything drawn is opaque, including the rider's one pixel black outline.
- `EmbedTrack` resamples the path every 1.5 px of travel, like the sim, so the caller may sample as finely or coarsely as it likes. A point with `air` > 0 breaks the track. Optional `slide` (0..1) draws the game's side slip band.

## Rules

- Pure: every function is a function of its arguments only. No DOM, `window`, `Date`, `performance` or `Math.random` (lint enforces it). Randomness comes from `core/rng.ts` seeded by the caller's `seed`.
- Imports `core/`, `render/` and pure `sim/` helpers. Never `state/`, `platform/` or `sim/sim` (boundary lint). Nothing in the game imports this folder.
- Every type the public API mentions is declared in `index.ts`. The declaration build fails if `powline-embed.d.ts` would import anything.
- Reuse the game's drawing code rather than redrawing it. If a render or sim file needs a change for the embed, keep the game pixel-identical: `tests/render.test.ts` must stay green without refreshing its hashes.
- `tests/embed.test.ts` covers the API, `tests/e2e/embed.spec.ts` loads the built bundle in Chromium.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if the build or its output changes.
