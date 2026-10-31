# src/render

Draws the current state into a 180x320 RGBA framebuffer. Sees the game only through the read-only `GameView` and `SimView` in `state/view.ts`. One colour (white on black) plus a yellow UI accent.

| File             | Job                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `framebuffer.ts` | Integer pixel buffer with pixel and rect helpers. Everything draws through it.                                                                                                 |
| `scene.ts`       | `SceneRenderer`: the world, obstacles, rider, particles.                                                                                                                       |
| `backdrop.ts`    | Parallax peaks.                                                                                                                                                                |
| `sprites.ts`     | Procedural trees, rocks, bushes.                                                                                                                                               |
| `riderSprite.ts` | Rider and board in every pose, unlockable looks. `maskBoard`, then `maskBody`, which solves a `Skeleton` and paints it in order: legs and torso, arms, helmet, headgear, face. |
| `ui.ts`          | `renderUi`: HUD, title, scores, gear, goals, pause.                                                                                                                            |
| `font.ts`        | 3x5 bitmap font.                                                                                                                                                               |
| `layout.ts`      | Shared UI position helpers.                                                                                                                                                    |
| `share.ts`       | Result card text, share URL and 1200x630 card drawing.                                                                                                                         |

## Rules

- May import `../sim`, `../state` and `../core`. No DOM here (`platform/shareDom.ts` does the canvas export).
- Only `framebuffer.ts` writes pixels directly.
- Do not import `state/game` or `sim/sim`, even as types (boundary lint). Writing to a view is a compile error. If you need a new value, add it to `GameView`.
- Lint enforces read-only access here: no `as` casts (except `as const`), type assertions, `!` or ts-comments, and every parameter must be read-only. Only `Framebuffer`, `Mask` and `Rng` may be taken as mutable. Callback parameters with inferred types are skipped, as they take their type from the view. TypeScript still lets a view object be assigned to a local or array annotated with a mutable type, and lint does not catch that, so do not write such annotations.
- The board length and rider scale live in `core/config.ts` (`BOARD_LEN`, `RIDER_SCALE`), because the sim's spin pivot uses them too.
- Visual changes must be checked in the running game (`npm run dev`), not just by tests. Keep `tests/contrast.test.ts` green.
- Button positions come from `state/menu.ts`, do not duplicate them.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
