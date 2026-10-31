# src/state

Everything around the sim: which screen you are on, menus, lifetime progress and saving.

| File           | Job                                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.ts`      | `Game`: runs and their phases (title, playing, paused, crashed, over), the camera, and what each frame steps. Owns the `Sim`, `Controls`, `Feedback`, `BrakeSpray` and particles. Implements `GameView`.                                                         |
| `controls.ts`  | `Controls`: taps, keys and buttons turned into actions (`press`, `handleInput`), the menu position (screen, score tab, focus), settings toggles, queued tricks and flips. Talks to the game through the narrow `ControlsHost`.                                   |
| `feedback.ts`  | `Feedback`: sim events turned into sound, toasts, haptics and hit-stop. Owns the toasts and the hit-stop timer.                                                                                                                                                  |
| `runReport.ts` | Pure helpers for a finished run: `summarizeRun`, `recordRun` (scoreboard and lifetime progress), `toCard`, `dayString`, and the `RunResult` type.                                                                                                                |
| `view.ts`      | `GameView`, `SimView`, `DeepReadonly`: the read-only types that are all `render/` may see.                                                                                                                                                                       |
| `menu.ts`      | Button layout (`menuButtons`) shared by `controls.ts` and `render/ui.ts`, plus the `Phase` and `Screen` types.                                                                                                                                                   |
| `progress.ts`  | Lifetime stats, achievements, challenges, unlockable gear. Pure data and rules, no storage.                                                                                                                                                                      |
| `storage.ts`   | `Store`: localStorage for scores, settings, progress. Every call guarded. Old `ghost:*` keys are deleted when a `Store` is built. Old `gates` and `ghosts` fields are dropped the next time that data is saved. An earned `photo` achievement stays in the save. |
| `effects.ts`   | `Particles` (fixed-size pool) and `BrakeSpray` (the plume a skid throws up).                                                                                                                                                                                     |

## Rules

- May import `../sim` and `../core`. From `render/` and `platform/` only types: `Sfx`, `Input` and `share` arrive through `GameDeps` in `main.ts`. Boundary lint enforces this.
- `Controls` does not import `Game`: anything it needs from the game goes on `ControlsHost`. Keep it narrow.
- Anything new that `render/` must read goes on `GameView` in `view.ts`, as data. Never put a mutating method on a view.
- Retiring an achievement: delete it from `ACHIEVEMENTS`. Saves keep the old id, and `Game.achievementCount` only counts ids that still exist.
- Saved data lives under `SAVE_PREFIX` in `core/config.ts`. Changing the shape of stored data needs a migration or a version bump.
- Adding a menu button: update `ButtonId` and `menuButtons` in `menu.ts`, add it to the `onButton` table in `controls.ts`, draw it in `render/ui.ts`. `onButton` and `onAction` are `Record`s, so a new id or action does not compile until it is handled.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
