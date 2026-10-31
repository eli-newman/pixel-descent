# Pixel Descent

A one-colour, pixel-art downhill snowboard game. White on black, with a single yellow accent for the UI. The rider, trees, rocks, bushes and peaks reuse the procedural pixel-art language of the original "pixel descent" scene.

Carve down an endless mountain, dodge trees and rocks, graze bushes, grab risk-lane stars, hit kickers. **Go straight to go fast, carve to stay alive.**

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

| Action             | Keyboard                       | Touch                                     |
| ------------------ | ------------------------------ | ----------------------------------------- |
| Steer toe / heel   | Left/Right, A/D                | Hold left or right half, or drag          |
| Spin (in the air)  | Hold Left/Right or A/D         | Hold left or right half, or drag          |
| Full-turn trick    | Space, T                       | Swipe left or right (a quick flick)       |
| Backflip           | Down, S (in the air)           | Swipe down                                |
| Frontflip          | Up, W (in the air)             | Swipe up                                  |
| Brake (side slip)  | Left + Right together          | Two fingers down at once                  |
| Menus              | Up/Down + Space/Enter          | Tap the buttons                           |
| Start / new run    | Space, Enter                   | Tap                                       |
| Pause / resume     | P, Esc, Space                  | Two bars (top right), tap                 |
| Restart, same seed | R                              | RETRY SEED                                |
| Share result       | C                              | SHARE (game over)                         |
| Sound on / off     | M (sound is ON by default)     | SOUND button on the title and pause menus |
| Big HUD, music     | H, U (music is OFF by default) | Pause menu                                |
| Manual spin on/off | G (default OFF)                | MANUAL SPIN button, pause menu            |

## Mechanics

### Speed: tuck or carve

Going **straight downhill** (heading share under 0.32) accelerates the rider well past cruising speed: noticeable acceleration (+62 px/s^2 minus air drag, about 3 s to top speed), a higher top speed than the old cap, speed lines, a louder and higher-pitched wind, a small rattle at the top, a camera that pulls up the slope for more lookahead, and the board drawn straight down with the rider crouched.

**Carving** across the slope scrubs speed: the target speed falls to 88% of cruising at full lock and speed above it bleeds off faster the more sideways the heading (rate 0.7 + 7 x hx per second). You trade control for speed.

| Quantity              | Value                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| Cruising speed (base) | `85 + 150 (1 - e^(-d/1000))` px/s, the original difficulty ramp                         |
| Top speed (straight)  | `min(340, 1.18 x cruise + 100)`: 200 at the start, 306 at 1000 m, 340 from about 1500 m |
| Hard cap              | 340 px/s (the old cap was about 235)                                                    |
| Bush hit / wall       | speed x 0.55 / speed x e^(-2t) while pinned against the edge                            |
| Snowdrift             | speed crawls to 42% of cruising                                                         |
| Camera lookahead      | the rider rises from 118 px to 86 px below the top as the tuck builds                   |

Risk and reward: the speed multiplier goes from x1 (cruising speed) to x2.5 (top speed) and scales points per metre, near misses, combos and tricks. The world is built so it stays fair at speed: the guaranteed open path gets wider with the top speed (up to +7 px), its segments get longer and gentler with distance, landing zones are sized for the fastest possible jump, and a test drives a path-following bot at the top speed for 7000 m on 12 seeds.

### Rest of the rules

- Trees, dead trees and boulders wipe you out. Pebbles are harmless. Bushes slow you down.
- Ringed risk-lane stars are +30 (the plain path stars are archived behind `PATH_STARS_ENABLED` in `src/config.ts`), and every metre counts 1 times the speed multiplier.
- A near miss (skimming a solid obstacle) scores +25 times the combo (up to x5) times the speed multiplier. A bar under the toast shows the combo timer draining.
- **Kickers** launch you. Nothing can hit you in the air, and the ground below a kicker is always clear. A shadow shows where you will land. Land with the board pointing downhill (heading under 0.35) for a clean landing (+6 speed); a sloppy landing (up to 0.7) costs 40% of your speed and your combo; landing sideways, or off the rotation, is a bail and a crash.
- **Spins**: in the air, hold left or right (A/D, or a half of the screen on touch) to spin that way. You keep turning a half turn at a time while you hold, and if you let go you finish the half turn you are in. A sideways swipe on touch (Space, T on keys) adds a full turn in the direction you hold, or the way you face. Spins turn at 720 degrees per second and stop on a half turn that fits the air time (less 0.06 s to settle), so you can always finish: a kicker hop gives a 180, a long or fast kicker a 360, a cliff drop 540 or 720. Spinning squares the board up, so holding a direction in the air no longer swings your heading sideways.
- **Manual spin** (setting, default OFF; pause menu button MANUAL SPIN or the G key): the air controls become fully manual. Holding left turns the rider counter-clockwise and holding right clockwise, at 600 degrees per second with a short ease in and out. Let go and he holds that angle: nothing finishes the half turn for you and there is no cap, so you have to release at a good angle before touchdown. The TRICK key snaps an extra half turn (180 at 1440 degrees per second) in the direction held, or the way you face; presses stack. Spinning back nets the angle (+180 then -180 is 0, no spin points). Landing uses the same rules on the final angle (the nearest half turn, clean within 40 degrees, sloppy up to 65, bail beyond), and pays the degrees you actually turned rounded to the nearest 180, so a held 360 pays the 360 points. A bail from a mistimed release is on you. In both modes the arrows never steer in the air: the flight path (x, heading, speed) is fixed by the launch and gravity, and the keys only rotate the rider. The mode is part of the run's rules, so toggling it in the pause menu applies from the next run (the menu says so); on the title screen it applies at once. Replays record the mode, and older replays play as assisted.
- **Landing a spin**: the rider has to be within 40 degrees of a half turn for a clean landing, within 65 for a sloppy one (speed scrub and combo broken, no spin points), and a bail beyond that (the cap makes this rare, it only happens if you land before finishing). An odd number of half turns (180, 540) lands backwards: a "SWITCH LANDING", worth the same points but +10 speed instead of +16. Full turns (360, 720) land forward.
- **Flips**: in the air, Up or W is a frontflip and Down or S a backflip (touch: swipe up for a frontflip, swipe down for a backflip). A flip is a full 360 degrees end over end, separate from the spins, so you can combine them in one jump (360 + backflip). Assisted: a press, or holding the key, starts a flip at 600 degrees per second; it is capped by air time (less 0.06 s to settle) so it always finishes before touchdown. A kicker hop is usually too short and the press does nothing, a fast kicker (about 220 px/s and up) allows one flip, a cliff drop allows two. More presses queue extra flips only while time allows, and the direction of the first flip sticks for the jump. Manual spin mode: holding Up/W (frontflip) or Down/S (backflip) pitches the rider at 540 degrees per second (with a short ease), release holds the angle, and a backflip then a frontflip nets out. Landing is judged on the pitch normalised to the nearest full turn: clean within 40 degrees, sloppy up to 70 (speed scrub, combo broken, no points), a bail beyond (he lands on his head). Pitch and yaw are judged independently, and the worse of the two decides. Flips never change the flight path.
- **Flip score**: paid on a clean landing, times the speed multiplier. 1 flip = 80, 2 = 220, 3 = 400 points (then +200 each, manual mode only). Landing a flip together with a spin adds a combo bonus of +50% of the flip and spin points. Toasts: "BACKFLIP!", "DOUBLE FRONTFLIP!" when the flip finishes, and "360 BACKFLIP +pts" on a clean combo landing. Each landed flip counts as one trick for the stats, achievements and gear unlocks.
- **Cliffs**: a rock ledge made of 2-4 chunks at slightly different heights, or sometimes a single chunk hugging one side of the screen. Only the rock drops you; the open slope between and beside the chunks is a way down. Every cliff is seeded, so no two look alike.
- **Spin score**: paid on a clean landing, times the speed multiplier. 180 = 30, 360 = 70, 540 = 120, 720 = 180 points. The toast shows the degrees ("360!") when the spin finishes, and each landed spin counts as one trick for the stats, achievements and gear unlocks. A cliff drop still adds its own +75 bonus.
- **Avalanche (archived)**: switched off with `AVALANCHE_ENABLED = false` in `src/config.ts`; all the code is kept, flip it to true to be chased again. When on, a dithered white wall comes down from above the screen. It runs at 68% of cruising speed at the start, about 87% at 1000 m and 100% by 2000 m, surges when you are slower than cruising speed (bushes, snowdrifts, hard carving), and catches up if it falls too far behind. It buries you if it reaches you. A gauge, a crackling edge and a low rumble warn you. On touch it is 8% slower.
- **Ice** (bare oval with glints): looser steering and almost no carve scrub. **Snowdrifts** (stippled mound with ripples): heavy snow, you crawl. Neither kills you.
- **Risk lane**: a narrow side line next to the path with a trail of ringed stars worth 30 each, flanked by trees. The lane, and the strips leading in and out of it, are always clear.
- Per seed top 10 boards and an overall best are kept in `localStorage`. (The best-run ghost is archived, see below.)
- Achievements and challenges (50 close calls, 1000 m without lane stars, 10 tricks, 25 lane stars) unlock boards and riders on the GEAR screen: stripe, dots and twin tip boards, beanie, scarf and ears riders.
- `prefers-reduced-motion` turns off screen shake, zoom punches, snowfall, speed lines, particles, the avalanche crest animation, the panel slide and blinking.

## Architecture

Plain TypeScript and Vite, no runtime dependencies. The simulation is pure and DOM-free, so it is unit tested with vitest.

- `src/sim.ts` - the whole rule set as a pure class: feed it a seed and inputs at the fixed step and it always plays the same run. The game, the ghost and the tests all run it. Produces `events` each step.
- `src/rider.ts` - rider physics and the speed model (`cruiseSpeed`, `topSpeed`, tuck and scrub, air, spins, flips).
- `src/avalanche.ts`, `src/score.ts`, `src/collision.ts`, `src/trail.ts`, `src/rng.ts` - the wall, scoring and combos, hit boxes and near-miss rules, an allocation-free trail, seeded PRNG and the daily seed.
- `src/world/spawner.ts` - deterministic endless course generator with independent seeded streams. A wandering guaranteed-open path keeps every course winnable; kickers, risk lanes, ice and drifts are planned so they never break that guarantee.
- `src/replay.ts` - input recording and playback (a run is a seed, the spin mode and input changes, including the flip bits; older replays play with no flips), used for ghosts.
- `src/progress.ts`, `src/storage.ts` - achievements, challenges and gear; localStorage access (every call guarded) for boards, settings, progress and ghosts.
- `src/game.ts` - the shell around the sim: phases (title, playing, paused, crashed, over), menus, hit-stop, camera, effects, persistence, audio and ghost. `src/menu.ts` holds the button layout shared by input and drawing.
- `src/input.ts`, `src/audio.ts`, `src/effects.ts` - keyboard, mouse and touch input; procedural WebAudio (quiet wind, carve hiss, avalanche rumble, pitch ladders, optional music); a fixed particle pool.
- `src/render/` - `framebuffer.ts` (integer pixel buffer), `sprites.ts`, `riderSprite.ts` (rider, tuck, flip squash and tuck, wipeout, unlockable looks), `backdrop.ts`, `scene.ts` (world, zoom punch), `font.ts` and `ui.ts` (3x5 pixel font, HUD, menus), `layout.ts`.
- `src/share.ts`, `src/shareDom.ts` - the 1200x630 result card (pure drawing, plus canvas export) and the Web Share / clipboard / download flow.
- `src/loop.ts` - fixed 120 Hz timestep with a requestAnimationFrame render. `src/viewport.ts` - largest whole-number scale of the 180x320 canvas that fits the window.
- `src/main.ts` - wiring. In dev builds `window.__game`, `window.__input` and `window.__store` are exposed for debugging.

## Archived: checkpoint gates

Checkpoint gates are switched off with `CHECKPOINTS_ENABLED` in `src/config.ts`; all their code is still in the repo. Set it to `true` to bring them back (pass between the fat poles under the banner for +100). The state just before they were turned off is tagged `archive/checkpoints`.

## Archived: ghost rider

The ghost (a faint replay of your best run on a seed) is switched off with `GHOST_ENABLED` in `src/config.ts`; the recording and playback code is still here. Set it to `true` to race your ghost again.

- **Brake**: hold left and right together (A+D or both arrows). The board swings sideways, snow sprays into your face and you plow down to a crawl (about 30% of cruise speed) while still sliding downhill. Release to carve again. Not available in the air. On touch, put two fingers down at once.
