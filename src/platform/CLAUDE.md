# src/platform

The edge of the game: everything that talks to the browser. Keep browser APIs in this folder so `sim/` and `state/` stay testable.

| File          | Job                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `input.ts`    | Keyboard, mouse, touch and swipe turned into `Action`s and taps, and a held-steer value. Cancels browser zoom gestures. |
| `loop.ts`     | Fixed 120 Hz update with a requestAnimationFrame render.                                                                |
| `viewport.ts` | Largest whole-number scale of the 180x320 canvas that fits, with safe-area margin.                                      |
| `audio.ts`    | Procedural WebAudio (wind, carve hiss, rumble, pitch ladders, music).                                                   |
| `shareDom.ts` | Web Share / clipboard / download flow for the result card.                                                              |

## Rules

- May import `../core` and `../render/share` and `../render/framebuffer` (for the card). Not `sim/`, not `state/` except types.
- `Game` never imports from here at runtime. It receives `Sfx` and `Input` as dependencies built in `main.ts`.
- The page must never zoom, and a zoom must never resize the game. iOS Safari ignores `user-scalable=no`, so `input.ts` cancels pinches and the end of every touch outside a button (a double tap would otherwise zoom). `main.ts` sizes the game from `documentElement.clientWidth` and `clientHeight`, because `innerWidth` and `innerHeight` shrink while iOS Safari is zoomed. Desktop emulators do not show this: check it in the iOS Simulator or on a phone.
- Every browser API call that can throw (storage, vibrate, share, audio context) must be guarded.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
