# src/platform

The edge of the game: everything that talks to the browser. Keep browser APIs in this folder so `sim/` and `state/` stay testable.

| File          | Job                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.ts`    | Keyboard, mouse, touch and swipe turned into `Action`s and taps, a held-steer value and the grab (`grab`, `setAir`). Cancels browser zoom gestures. |
| `loop.ts`     | Fixed 120 Hz update with a requestAnimationFrame render.                                                                                            |
| `viewport.ts` | Largest whole-number scale of the 180x320 canvas that fits, with safe-area margin.                                                                  |
| `audio.ts`    | Procedural WebAudio (wind, carve hiss, rumble, pitch ladders, music).                                                                               |
| `shareDom.ts` | Web Share / clipboard / download flow for the result card.                                                                                          |

## Rules

- May import `../core` and `../render/share` and `../render/framebuffer` (for the card). Not `sim/`, not `state/` except types.
- `Game` never imports from here at runtime. It receives `Sfx` and `Input` as dependencies built in `main.ts`.
- The page must never zoom, and a zoom must never resize the game. iOS Safari ignores `user-scalable=no`, so `input.ts` cancels pinches and the end of every touch outside a button (a double tap would otherwise zoom). `main.ts` sizes the game from `documentElement.clientWidth` and `clientHeight`, because `innerWidth` and `innerHeight` shrink while iOS Safari is zoomed. Desktop emulators do not show this: check it in the iOS Simulator or on a phone.
- Touch gestures (`input.ts`): a finger holds its half of the screen only after `HOLD_MS` still (or `SWIPE_MS` of moving without a flick), never at once, because in the air even one step of hold commits a half turn and every swipe would start with a spin. A quick flick is vertical (a flip) unless its sideways part is more than `SWIPE_SLANT` times its vertical part, so a slanted thumb flick down is still the FRONTFLIP and only a clearly sideways one is a spin. A vertical flick (`FLIP_SWIPE_MIN` px within any `SWIPE_MS` of the touch) also counts after resting the thumb; a sideways one only within `SWIPE_MS` of touching, so a steering drag never spins. Swipe down sends `down`, which is flip 1, shown as FRONTFLIP (see the flip naming note in `src/sim/CLAUDE.md`). The hold is timed on the `now` clock passed to `Input` (`performance.now()` in the browser), flicks on event `timeStamp` differences, so the two clocks never mix.
- Grabs (`input.ts`): X or Shift held is a grab. On touch (one thumb), a still touch in the air lifted within `TAP_MS` grabs, and stays grabbed until the next touch lands (it lets go on touch down, not lift, so a late tap still lets go before touchdown; lifting that touch quickly does not grab again) or the game says the rider is down (`setAir(false)`). So a tap never spins, a new still touch in the air holds its side only after `TAP_MS` instead of `HOLD_MS`. Flicks, drags and two fingers never grab.
- Every browser API call that can throw (storage, vibrate, share, audio context) must be guarded.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
