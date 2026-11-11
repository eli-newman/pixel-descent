# Powline

Play at https://powline.vercel.app

A pixel-art downhill snowboard (or ski) game. White on black, with a single yellow accent for the UI and two greys for the shadow of your track, or in colour: white snow, dark green pines with snow on them and brown trunks, dark grey and brown rocks with snow caps, natural rock cliffs, packed snow jumps with orange marker poles, and a light track pressed into the snow. The rider, trees, rocks, bushes and peaks reuse the procedural pixel-art language of the game's original scene.

Carve down an endless mountain, dodge trees and rocks, graze bushes, grab risk-lane stars, hit kickers. **Go straight to go fast, carve to stay alive.**

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, runs the tests, then bundles to dist/
npm run preview    # serve the production build
npm run lint
npm run typecheck
npm test
npm run test:e2e   # browser smoke test (first run: npx playwright install chromium)
npm run check      # typecheck, lint, format check and tests
npm run format     # prettier
```

Players never see a seed: every run is just a new course. The game over SHARE link carries one internally (`?seed=...`), so a friend who opens it gets the same course, and the address bar drops it on load. The same seed always generates the same trees, rocks, stars, kickers, ice, drifts and risk lanes. The **daily** course (seed `d20261020` style, from the local date) is the same for everyone on a given day.

The build uses relative URLs (`base: './'`), so the contents of `dist/` work from any folder, for example `https://example.com/games/powline/`. `public/og.png` is the link preview image (1200x630, drawn by the share card renderer). Crawlers need an absolute `og:image` URL, so the `og:image`, `twitter:image` and `og:url` tags in `index.html` point at https://powline.vercel.app: update them if the address changes.

## Privacy

Powline counts visits and a few game events with [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy), which sets no cookies and stores nothing on your device, so there is no consent banner. What it sends:

- a page view (page, referring site, country, browser, OS and device type, as Vercel collects them); a visit from a shared link is reported as the page `/from-share`,
- **Run Start**: which run of this visit it is (1, 2, 3, 4-5, 6-10, 11+) and the setup (board or skis, mono or color, normal or daily),
- **Run End**: the distance and the score, each in a coarse band (for example 250-499 m),
- **Share**: which way the share went (Web Share with the image or the link, clipboard, download, cancelled).

Never sent: seeds, share links, exact scores, names, saved data, or any identifier. The address sent drops every query value except `utm_*` campaign tags. Analytics only runs in builds made by Vercel (`VERCEL=1`) or with `VITE_ANALYTICS=1`, so `npm run dev`, the tests and copies of `dist/` on other hosts load nothing. If the script is blocked, the game does not notice.

## Controls

| Action             | Keyboard                       | Touch                                     |
| ------------------ | ------------------------------ | ----------------------------------------- |
| Steer toe / heel   | Left/Right, A/D                | Hold left or right half, or drag          |
| Spin (in the air)  | Hold Left/Right or A/D         | Hold left or right half, or drag          |
| Full-turn trick    | Space, T                       | Swipe left or right (a quick flick)       |
| Frontflip          | Down, S (in the air)           | Swipe down (a quick flick, slant is fine) |
| Backflip           | Up, W (in the air)             | Swipe up (a quick flick, slant is fine)   |
| Grab               | Hold X or Shift (in the air)   | Quick tap in the air; next touch lets go  |
| Brake (side slip)  | Left + Right together          | Two fingers down at once                  |
| Menus              | Up/Down + Space/Enter          | Tap the buttons                           |
| Start / new run    | Space, Enter                   | Tap                                       |
| Pause / resume     | P, Esc, Space                  | Two bars (top right), tap                 |
| Retry same course  | R                              | RETRY                                     |
| Share result       | C                              | SHARE (game over)                         |
| Sound on / off     | M (sound is ON by default)     | SOUND button on the title and pause menus |
| Big HUD, music     | H, U (music is OFF by default) | Pause menu                                |
| Manual spin on/off | G (default OFF)                | MANUAL SPIN button, pause menu            |
| Colour on / off    | Menus (default OFF)            | COLOR button on the title and pause menus |

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

- Trees, dead trees and rocks wipe you out. Pebbles are harmless. Bushes slow you down.
- **Reading the slope**: anything that stands up out of the snow casts a checkered shadow, and solid white ones (pines, bare dead trees, angular cracked rocks) crash you. A bush is a cluster of three round puffs speckled with dark leaf holes: it slows you, never stops you. Pebbles lie flat (two pixels tall, no shadow) and you ride straight over them. Things lying on the snow have no shadow: ice, deep snow and stars.
- **First-run labels**: on your first 3 runs (counted from the update that added them, so existing players get them too) a small yellow word sits over the next thing of each kind below you: CRASH over trees, dead trees and rocks, SLOWS over a bush, ICE, DEEP SNOW, and +30 over a star. One per kind, never over the score or each other, and they ride with the slope without blinking.
- Risk-lane stars (solid five-point stars) are +30, and every metre counts 1 times the speed multiplier.
- A near miss (skimming a solid obstacle) scores +25 times the combo (up to x5) times the speed multiplier. A bar under the toast shows the combo timer draining.
- **Jumps** come about every 85 m (a takeoff every 3 to 4 s at cruising speed, the first one about 45 m below the start), so the middle of a run never goes quiet. About eight in ten are **kickers**: a wide outlined ramp on the open path, with two arrows on its face pointing down the hill and a thick lip, so it cannot be mistaken for a tree, rock, bush or drift. The rest are cliffs. Kickers launch you. Nothing can hit you in the air, and the ground below a jump is always clear. A jump never shares ground with a risk lane, its run-up is never on ice or a drift, and the next jump only comes at least 300 px (about 37 m) after the last landing zone ends. When a risk lane falls due it is fitted into the gap before the next jump. A shadow shows where you will land. Land with the board pointing downhill (heading under 0.35) for a clean landing (+6 speed); a sloppy landing (up to 0.7) costs 40% of your speed and your combo; landing sideways, or off the rotation, is a bail and a crash.
- **Jump lines**: from 150 m on, some kickers come as a line of 2 or 3 in a row (about one kicker in five starts a line at first, rising to almost one in two far down). The kickers of a line are the same width, sit on the same line straight down the hill, and carry a row of pips over them, one per kicker, filled up to this one (2 of 3 reads as two filled and one hollow). Each lip comes a short run-up after the previous landing zone, and the whole line is clear across the slope, with room after it to steer back to the path. Landing every kicker clean builds a line multiplier on each landing's trick points: x1 on the first, x1.5 on the second, x2 on the third. The toast says "LINE X1.5" (what the next kicker pays) under the landing, and "LINE CLEAN +pts" when the whole line is landed clean, which pays 30 per kicker times the speed multiplier even with no tricks. A sloppy landing ("LINE BROKEN"), a bail or riding past the next kicker ("LINE MISSED") ends the line.
- **Spins**: in the air, hold left or right (A/D, or a half of the screen on touch) to spin that way. You keep turning a half turn at a time while you hold, and if you let go you finish the half turn you are in. A sideways swipe on touch (Space, T on keys) adds a full turn in the direction you hold, or the way you face. Spins turn at 720 degrees per second and stop on a half turn that fits the air time (less 0.06 s to settle), so you can always finish: a kicker hop gives a 180, a long or fast kicker a 360, a cliff drop 540 or 720. Spinning squares the board up, so holding a direction in the air no longer swings your heading sideways.
- **Manual spin** (setting, default OFF; pause menu button MANUAL SPIN or the G key): the air controls become fully manual. Holding left turns the rider counter-clockwise and holding right clockwise, at 600 degrees per second with a short ease in and out. Let go and he holds that angle: nothing finishes the half turn for you and there is no cap, so you have to release at a good angle before touchdown. The TRICK key snaps an extra half turn (180 at 1440 degrees per second) in the direction held, or the way you face; presses stack. Spinning back nets the angle (+180 then -180 is 0, no spin points). Landing uses the same rules on the final angle (the nearest half turn, clean within 40 degrees, sloppy up to 65, bail beyond), and pays the degrees you actually turned rounded to the nearest 180, so a held 360 pays the 360 points. A bail from a mistimed release is on you. In both modes the arrows never steer in the air: the flight path (x, heading, speed) is fixed by the launch and gravity, and the keys only rotate the rider. The mode is part of the run's rules, so toggling it in the pause menu applies from the next run (the menu says so); on the title screen it applies at once.
- **Landing a spin**: the rider has to be within 40 degrees of a half turn for a clean landing, within 65 for a sloppy one (speed scrub and combo broken, no spin points), and a bail beyond that (the cap makes this rare, it only happens if you land before finishing). An odd number of half turns (180, 540) swaps your stance: you ride away switch, the other foot forward and facing the other way on the board (chest to the camera heading right, back to the camera heading left; on skis you ski backwards), and you stay switch until another odd half turn brings you back. A half turn is worth the same points but +10 speed instead of +16. Full turns (360, 720) keep the stance you took off in. A clean landing that rides away switch says "SWITCH LANDING". Steering is the same either way, and every run starts regular.
- **Flips**: in the air, Up or W is a backflip and Down or S a frontflip (touch: swipe up for a backflip, swipe down for a frontflip; a slanted flick counts, and so does a flick after resting the thumb on the screen. A touch only holds its side, and so spins in the air, once it is clearly not a flick, about 0.08 s). A flip is a full 360 degrees end over end, separate from the spins, so you can combine them in one jump (360 + backflip). Assisted: a press, or holding the key, starts a flip at 600 degrees per second; it is capped by air time (less 0.06 s to settle) so it always finishes before touchdown. A kicker hop is usually too short and the press does nothing, a fast kicker (about 220 px/s and up) allows one flip, a cliff drop allows two. More presses queue extra flips only while time allows, and the direction of the first flip sticks for the jump. Manual spin mode: holding Up/W (frontflip) or Down/S (backflip) pitches the rider at 540 degrees per second (with a short ease), release holds the angle, and a backflip then a frontflip nets out. Landing is judged on the pitch normalised to the nearest full turn: clean within 40 degrees, sloppy up to 70 (speed scrub, combo broken, no points), a bail beyond (he lands on his head). Pitch and yaw are judged independently, and the worse of the two decides. Flips never change the flight path.
- **Flip score**: paid on a clean landing, times the speed multiplier. 1 flip = 80, 2 = 220, 3 = 400 points (then +200 each, manual mode only). Landing a flip together with a spin adds a combo bonus of +50% of the flip and spin points. Toasts: "BACKFLIP!", "DOUBLE FRONTFLIP!" when the flip finishes, and "360 BACKFLIP +pts" on a clean combo landing. Each landed flip counts as one trick for the stats, achievements and gear unlocks.
- **Grabs**: in the air, hold X or Shift to grab the board (on skis, the near ski), knees pulled up, one hand on the board and the other arm thrown up. On touch, a quick tap in the air (lifted within 0.16 s, without moving) grabs, and the next touch lets go the moment it lands, so it works with one thumb. In the air a still touch only holds its side (and spins) after those 0.16 s, so a tap never spins you. A grab counts once it is held 0.15 s ("GRAB!"). Let go before touchdown: landing still grabbing is sloppy ("STILL GRABBING": speed scrubbed, combo broken, nothing paid), and after a flip or a spin of 540 or more it is a bail. Grabs work with spins and flips in both spin modes and never change the flight path.
- **Grab score**: paid on a clean landing, times the speed multiplier: 20 points once it counts, plus 100 for every second held after that (a kicker hop holds about 0.4 s, a cliff drop about 1 s). Grabbed with a spin or flip, it adds half the spin and flip points again on top, so a grabbed 360 is worth more than a 360 plus a grab. Toasts: "GRAB +pts", "360 GRAB +pts", "540 FRONTFLIP GRAB +pts". Each landed grab counts as one trick for the stats, achievements and gear unlocks.
- **Cliffs**: a rock ledge made of 2-4 chunks at slightly different heights, or sometimes a single chunk hugging one side of the screen. Only the rock drops you; the open slope between and beside the chunks is a way down. Every cliff is seeded, so no two look alike.
- **Spin score**: paid on a clean landing, times the speed multiplier. 180 = 30, 360 = 70, 540 = 120, 720 = 180 points. The toast shows the degrees ("360!") when the spin finishes, and each landed spin counts as one trick for the stats, achievements and gear unlocks. A cliff drop still adds its own +75 bonus.
- **Brake**: hold left and right together (A+D or both arrows). The board swings sideways, snow sprays up and you plow down to a crawl (about 30% of cruise speed) while still sliding downhill. Release to carve again. Not available in the air. On touch, put two fingers down at once (within 0.15 s). A second thumb that lands later is not a brake: the newest finger steers, so you can roll from one thumb to the other to turn, and lifting it hands steering straight back to the finger still down.
- **Ice** (bare oval with glints): looser steering and almost no carve scrub. **Snowdrifts** (rows of little humps of deep snow): heavy snow, you crawl. Neither kills you.
- **Risk lane**: a narrow side line next to the path with a trail of stars worth 30 each, flanked by trees. The lane, and the strips leading in and out of it, are always clear.
- An all-time top 10, a top 10 for today's daily course and your best score are kept in `localStorage`. Your best counts across every course.
- Achievements and challenges (50 close calls, 1000 m without lane stars, 10 tricks, 25 lane stars) unlock boards and riders on the GEAR screen: stripe, dots and twin tip boards, beanie, scarf and ears riders.
- **Skis**: the top of the GEAR screen picks SNOWBOARD or SKIS (open to everyone, remembered between visits, a snowboard by default). Skiing is a look, not a different game: the speed, steering, tricks, landings and scores are exactly the same, so the same course and inputs give the same run. The skier has two skis and poles, brakes with a hockey stop, and leaves two thin parallel lines in the snow instead of the board's one. Board looks carry over to the skis (stripes, dots, twin tips) and rider looks to the skier. The share text says "on skis".
- The game has one calm look on every device, so phone and desktop match: no screen shake, zoom punches, snowfall, speed lines, panel slide or blinking. Braking throws up a light spray, a hard carve at speed throws a cloud of powder out of the turn that hangs behind you and thins away, and even running straight the board leaves a wake of powder behind it.
- Toasts and the combo meter sit near the top of the screen; while a high jump carries the rider up through them they move lower down, so they never hide the trick they name.

## Architecture

Plain TypeScript and Vite, no runtime dependencies. The simulation is pure and DOM-free, so it is unit tested with vitest.

- `src/sim/sim.ts` - the whole rule set as a pure class: feed it a seed and inputs at the fixed step and it always plays the same run. The game and the tests both run it. Produces `events` each step.
- `src/sim/rider.ts`, `riderState.ts`, `speed.ts`, `tricks.ts`, `pose.ts` - the rider step (heading, braking, walls), its state, the speed model (`cruiseSpeed`, `topSpeed`, tuck and scrub, air time), spins, flips and grabs, and the pose the renderer draws.
- `src/sim/landing.ts`, `src/sim/world.ts` - landing judgement and payout; the live object lists, culling, surface and ramp checks.
- `src/sim/score.ts`, `src/sim/collision.ts`, `src/sim/trail.ts`, `src/core/rng.ts`, `src/core/detMath.ts` - scoring and combos, hit boxes and near-miss rules, an allocation-free trail, seeded PRNG and the daily seed, and an `exp` that gives the same bits in every browser, so a seed is the same course everywhere.
- `src/sim/spawner.ts` - deterministic endless course generator with independent seeded streams. A wandering guaranteed-open path keeps every course winnable; kickers, jump lines, risk lanes, ice and drifts are planned so they never break that guarantee. `src/sim/lines.ts` follows the jump line being ridden and pays its multiplier and bonus.
- `src/state/progress.ts`, `src/state/storage.ts` - achievements, challenges and gear; localStorage access (every call guarded) for boards, settings and progress.
- `src/state/game.ts` - the shell around the sim: runs and their phases (title, playing, paused, crashed, over), camera, and what each frame steps, drawn between steps so motion is even on 60, 90 and 120 Hz screens. `src/state/controls.ts` turns input into actions and holds the menu position, `src/state/feedback.ts` turns sim events into sound, toasts, haptics and hit-stop, `src/state/runReport.ts` saves a finished run, `src/state/view.ts` is the read-only view render gets, and `src/state/menu.ts` holds the button layout shared by input and drawing.
- `src/platform/input.ts`, `src/platform/audio.ts`, `src/state/effects.ts` - keyboard, mouse and touch input; procedural WebAudio (quiet wind, carve hiss, pitch ladders, optional music); a fixed particle pool.
- `src/render/` - `framebuffer.ts` (integer pixel buffer), `sprites.ts`, `riderSprite.ts` (snowboarder and skier, tuck, flip squash and tuck, grab, wipeout, unlockable looks), `backdrop.ts`, `track.ts` (the track: one clean line for the board or two thin lines for skis, swelling gently in turns, with a soft grey shadow, powder spilled along its edges and more thrown out of hard turns), `scene.ts` (world), `font.ts` and `ui.ts` (3x5 pixel font, HUD, menus), `layout.ts`.
- `src/render/share.ts`, `src/platform/shareDom.ts` - the 1200x630 result card (pure drawing, plus canvas export) and the Web Share / clipboard / download flow.
- `src/platform/loop.ts` - fixed 120 Hz timestep with a requestAnimationFrame render. `src/platform/viewport.ts` - largest whole-number scale of the 180x320 canvas that fits the window.
- `src/platform/analytics.ts`, `src/state/telemetry.ts` - Vercel Web Analytics without the npm package (the script tag, a URL cleaner, a never-throwing tracker) and the anonymous run events in coarse bands.
- `src/main.ts` - wiring. In dev builds `window.__game`, `window.__input` and `window.__store` are exposed for debugging.

## Removed features

Checkpoint gates, plain path stars, the ghost rider (with its replay recording) and the avalanche were removed from the code. Each is recoverable from a git tag: `archive/checkpoints`, `archive/path-stars`, `archive/ghost`, `archive/avalanche`. The PHOTO FINISH achievement went with the avalanche; older saves keep the record but it is no longer listed or counted.
