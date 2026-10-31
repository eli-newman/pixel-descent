# src/core

Foundation. Imports nothing from the rest of the game. Everything else may import from here.

| File         | Job                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`  | Every tuning constant: canvas size (180x320), fixed step (1/120), speeds, rider scale and board length (`RIDER_SCALE`, `BOARD_LEN`, shared by sim, state and render), storage keys. |
| `rng.ts`     | Seeded PRNG, `normalizeSeed`, the daily seed (`dYYYYMMDD`). Same seed must always give the same course.                                                                             |
| `detMath.ts` | `detExp`: `e^x` from `+ - * /` only, so it gives the same bits in every browser. Math.exp does not (V8 and JavaScriptCore differ).                                                  |

## Rules

- No DOM, no `window`, no imports from other `src/` folders.
- New tunable number: add it to `config.ts` with a doc comment.
- Changing `rng.ts` or `detMath.ts` output can change every course, which breaks shared seed links and per-seed boards. Do not do it casually.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
