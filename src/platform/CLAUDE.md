# src/platform

The edge of the game: everything that talks to the browser. Keep browser APIs in this folder so `sim/` and `state/` stay testable.

| File          | Job                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------- |
| `input.ts`    | Keyboard, mouse, touch and swipe turned into `Action`s and taps, and a held-steer value. |
| `loop.ts`     | Fixed 120 Hz update with a requestAnimationFrame render.                                 |
| `viewport.ts` | Largest whole-number scale of the 180x320 canvas that fits, with safe-area margin.       |
| `audio.ts`    | Procedural WebAudio (wind, carve hiss, rumble, pitch ladders, music).                    |
| `shareDom.ts` | Web Share / clipboard / download flow for the result card.                               |

## Rules

- May import `../core` and `../render/share` and `../render/framebuffer` (for the card). Not `sim/`, not `state/` except types.
- `Game` never imports from here at runtime. It receives `Sfx` and `Input` as dependencies built in `main.ts`.
- Every browser API call that can throw (storage, vibrate, share, audio context) must be guarded.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
