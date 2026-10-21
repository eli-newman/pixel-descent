# Pixel Descent

A one-colour, pixel-art downhill snowboard game. White on black, with a single yellow accent for the UI. The rider, trees, rocks, bushes and peaks reuse the procedural pixel-art language of the original "pixel descent" scene.

Carve down an endless mountain, dodge trees and rocks, graze bushes, grab stars, hit kickers, thread the checkpoint flags and stay ahead of the avalanche. **Go straight to go fast, carve to stay alive.**

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

Share a course by sharing the URL: the seed is kept in `?seed=...` (for example `http://localhost:5173/?seed=k3m9qa`). The same seed always generates the same trees, rocks, stars, kickers, ice, drifts and risk lanes. The **daily** seed (`d20261020` style, from the local date) is the same for everyone on a given day.

The build uses relative URLs (`base: './'`), so the contents of `dist/` work from any folder, for example `https://example.com/games/descent/`. `public/og.png` is the link preview image (1200x630, drawn by the share card renderer). Most crawlers want an absolute `og:image` URL: edit the two `og:image`/`twitter:image` tags in `index.html` once the final address is known.

## Controls

| Action             | Keyboard                       | Touch                                 |
| ------------------ | ------------------------------ | ------------------------------------- |
| Steer toe / heel   | Left/Right, A/D                | Hold left or right half, or drag      |
| Trick (in the air) | Space, T, Up, W                | TRICK button (bottom right)           |
| Menus              | Up/Down + Space/Enter          | Tap the buttons                       |
| Start / new run    | Space, Enter                   | Tap                                   |
| Pause / resume     | P, Esc, Space                  | II button (top right), tap            |
| Restart, same seed | R                              | RETRY SEED                            |
| Share result       | C                              | SHARE (game over)                     |
| Sound on / off     | M (sound is ON by default)     | SND button, SOUND button on the menus |
| Big HUD, music     | H, U (music is OFF by default) | Pause menu                            |

## Mechanics

### Speed: tuck or carve

Going **straight downhill** (heading share under 0.32) accelerates the rider well past cruising speed: noticeable acceleration (+62 px/s^2 minus air drag, about 3 s to top speed), a higher top speed than the old cap, speed lines, a louder and higher-pitched wind, a small rattle at the top, a camera that pulls up the slope for more lookahead, and the board drawn straight down with the rider crouched.

**Carving** across the slope scrubs speed: the target speed falls to 88% of cruising at full lock and speed above it bleeds off faster the more sideways the heading (rate 0.7 + 7 x hx per second). You trade control for speed.

| Quantity              | Value                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| Cruising speed (base) | `85 + 150 (1 - e^(-d/1000))` px/s, the original difficulty ramp                         |
| Top speed (straight)  | `min(340, 1.18 x cruise + 100)`: 203 at the start, 306 at 1000 m, 340 from about 1500 m |
| Hard cap              | 340 px/s (the old cap was about 235)                                                    |
| Bush hit / wall       | speed x 0.55 / speed x e^(-2t) while pinned against the edge                            |
| Snowdrift             | speed crawls to 42% of cruising                                                         |
| Camera lookahead      | the rider rises from 118 px to 86 px below the top as the tuck builds                   |

Risk and reward: the speed multiplier goes from x1 (cruising speed) to x2.5 (top speed) and scales points per metre, near misses, combos and tricks. The world is built so it stays fair at speed: the guaranteed open path gets wider with the top speed (up to +7 px), its segments get longer and gentler with distance, landing zones are sized for the fastest possible jump, and a test drives a path-following bot at the top speed for 7000 m on 12 seeds.

### Rest of the rules

- Trees, dead trees and boulders wipe you out. Pebbles are harmless. Bushes slow you down.
- Stars are +10, checkpoint flags (pass between the fat poles under the banner) +100, and every metre counts 1 times the speed multiplier.
- A near miss (skimming a solid obstacle) scores +25 times the combo (up to x5) times the speed multiplier. A bar under the toast shows the combo timer draining.
- **Kickers** launch you. Nothing can hit you in the air, and the ground below a kicker is always clear. A shadow shows where you will land. Land with the board pointing downhill (heading under 0.35) for a clean landing (+6 speed); a sloppy landing (up to 0.7) costs 40% of your speed and your combo; landing sideways, or mid-trick, is a bail and a crash. One tap of the trick button spins you for 0.42 s and needs that much air left. Each finished trick pays 50 x its number in the jump x the multiplier, but only on a clean landing.
- **Avalanche**: a dithered white wall comes down from above the screen. It runs at 68% of cruising speed at the start, about 87% at 1000 m and 100% by 2000 m, surges when you are slower than cruising speed (bushes, snowdrifts, hard carving), and catches up if it falls too far behind. It buries you if it reaches you. A gauge, a crackling edge and a low rumble warn you. On touch it is 8% slower.
- **Ice** (bare oval with glints): looser steering and almost no carve scrub. **Snowdrifts** (stippled mound with ripples): heavy snow, you crawl. Neither kills you.
- **Risk lane**: a narrow side line next to the path with a trail of ringed stars worth 30 each, flanked by trees. The lane, and the strips leading in and out of it, are always clear.
- Per seed top 10 boards and an overall best are kept in `localStorage`; the best run on a seed is saved as a **ghost** you race next time.
- Achievements and challenges (50 close calls, 1000 m without stars, 10 tricks, 25 lane stars) unlock boards and riders on the GEAR screen: stripe, dots and twin tip boards, beanie, scarf and ears riders.
- `prefers-reduced-motion` turns off screen shake, zoom punches, snowfall, speed lines, particles, the avalanche crest animation, the panel slide and blinking.

## Architecture

Plain TypeScript and Vite, no runtime dependencies. The simulation is pure and DOM-free, so it is unit tested with vitest.

- `src/sim.ts` - the whole rule set as a pure class: feed it a seed and inputs at the fixed step and it always plays the same run. The game, the ghost and the tests all run it. Produces `events` each step.
- `src/rider.ts` - rider physics and the speed model (`cruiseSpeed`, `topSpeed`, tuck and scrub, air, tricks).
- `src/avalanche.ts`, `src/score.ts`, `src/collision.ts`, `src/trail.ts`, `src/rng.ts` - the wall, scoring and combos, hit boxes and near-miss rules, an allocation-free trail, seeded PRNG and the daily seed.
- `src/world/spawner.ts` - deterministic endless course generator with independent seeded streams. A wandering guaranteed-open path keeps every course winnable; kickers, risk lanes, ice and drifts are planned so they never break that guarantee.
- `src/replay.ts` - input recording and playback (a run is a seed plus input changes), used for ghosts.
- `src/progress.ts`, `src/storage.ts` - achievements, challenges and gear; localStorage access (every call guarded) for boards, settings, progress and ghosts.
- `src/game.ts` - the shell around the sim: phases (title, playing, paused, crashed, over), menus, hit-stop, camera, effects, persistence, audio and ghost. `src/menu.ts` holds the button layout shared by input and drawing.
- `src/input.ts`, `src/audio.ts`, `src/effects.ts` - keyboard, mouse and touch input; procedural WebAudio (quiet wind, carve hiss, avalanche rumble, pitch ladders, optional music); a fixed particle pool.
- `src/render/` - `framebuffer.ts` (integer pixel buffer), `sprites.ts`, `riderSprite.ts` (rider, tuck, wipeout, unlockable looks), `backdrop.ts`, `scene.ts` (world, parallax ridges, zoom punch), `font.ts` and `ui.ts` (3x5 pixel font, HUD, menus), `layout.ts`.
- `src/share.ts`, `src/shareDom.ts` - the 1200x630 result card (pure drawing, plus canvas export) and the Web Share / clipboard / download flow.
- `src/loop.ts` - fixed 120 Hz timestep with a requestAnimationFrame render. `src/viewport.ts` - largest whole-number scale of the 180x320 canvas that fits the window.
- `src/main.ts` - wiring. In dev builds `window.__game`, `window.__input` and `window.__store` are exposed for debugging.
