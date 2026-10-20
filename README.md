# Pixel Descent

A one-colour, pixel-art downhill snowboard game. White on black, with a single yellow accent for the UI. The rider, trees, rocks, bushes and peaks reuse the procedural pixel-art language of the original "pixel descent" scene.

Carve down an endless mountain, dodge trees and rocks, graze bushes, grab stars, and thread the checkpoint flags. Speed ramps up the longer you last.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then bundles to dist/
npm run preview    # serve the production build
npm run lint
npm run typecheck
npm test
npm run format     # prettier
```

Share a course by sharing the URL: the seed is kept in `?seed=...` (for example `http://localhost:5173/?seed=k3m9qa`). The same seed always generates the same trees, rocks, stars and flags.

## Controls

| Action             | Keyboard          | Touch                            |
| ------------------ | ----------------- | -------------------------------- |
| Steer toe / heel   | Left/Right, A/D   | Hold left or right half, or drag |
| Start / restart    | Space, Enter      | Tap                              |
| Pause / resume     | P, Esc            | Pause button (top right), tap    |
| Restart, same seed | R                 | -                                |
| Sound on / off     | M (muted default) | -                                |

## Rules

- Trees, dead trees and boulders wipe you out. Pebbles are harmless. Bushes slow you down.
- Stars are +10, checkpoint flags (pass between the poles) +100, and every metre counts 1.
- A near miss (skimming a solid obstacle) scores +25, and chained near misses build a combo up to x5.
- The open path narrows and obstacles thicken with distance. The best score is saved in `localStorage`.
- `prefers-reduced-motion` turns off screen shake, snowfall, speed lines, particles and blinking.

## Architecture

Plain TypeScript and Vite, no runtime dependencies. The simulation is pure and DOM-free, so it is unit tested with vitest.

- `src/rng.ts` - seeded mulberry32 PRNG, string hashing, seed helpers.
- `src/world/spawner.ts` - deterministic endless course generator. A wandering guaranteed-open path keeps every course winnable, the start lane is always clear, and independent RNG streams make output independent of how it is requested.
- `src/world/types.ts`, `src/collision.ts`, `src/score.ts` - entities, hit boxes and near-miss rules, scoring and combos.
- `src/rider.ts` - rider physics. A damped spring eases the heading between toe side and heel side; the heading drives the pose, with the same hysteresis as the source art.
- `src/game.ts` - state machine (title, playing, paused, crashed, over) and all rules.
- `src/input.ts`, `src/audio.ts`, `src/storage.ts` - input to steering and actions, WebAudio blips, best score.
- `src/render/` - `framebuffer.ts` (integer pixel buffer), `sprites.ts` (ported tree, bush, rock, dead tree generators with cast shadows), `riderSprite.ts` (the solved snowboarder, wipeout), `backdrop.ts` (peaks and start gate), `scene.ts` (world), `font.ts` and `ui.ts` (3x5 pixel font, HUD, screens).
- `src/loop.ts` - fixed 120 Hz timestep with a requestAnimationFrame render.
- `src/viewport.ts` - largest whole-number device-pixel scale of the 180x320 canvas that fits the window, centred and letterboxed in black.
- `src/main.ts` - wiring. In dev builds `window.__game` and `window.__input` are exposed for debugging.
