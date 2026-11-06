# src/sim

The rules of the game as pure, deterministic code. Feed a seed and inputs at the fixed step and it always plays the same run. The live game and the tests both run it.

| File            | Job                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sim.ts`        | `Sim` class: one world step (`step(input, dt)`), emits `events` (crash, star, trick, ...). The hub of this folder.                                                             |
| `rider.ts`      | `stepRider`: heading spring, braking, movement, slope walls. Also `launch`, `riderZ`, `headingY`, `headingAngle`.                                                              |
| `riderState.ts` | `RiderState` (including `stance`: regular or switch), `Surface`, `Face`, `createRider`. Types and the starting state only.                                                     |
| `speed.ts`      | The speed model: `cruiseSpeed`, `topSpeed`, tuck and scrub (`stepSpeed`), air time and flight distance. The spawner's only rider dependency, so it must stay exact arithmetic. |
| `tricks.ts`     | Spins and flips: assisted and manual stepping, caps, `startTrick`/`startSnap`/`startFlip`, landing tolerances.                                                                 |
| `pose.ts`       | `RiderPose` and `poseOf`: what the renderer needs to draw the rider, including the stance. `heelSide` says which side of the rider shows.                                      |
| `landing.ts`    | `touchDown`: judges a landing (clean, sloppy, bail), swaps the stance after an odd number of half turns, pays the score, returns the `LandEvent`.                              |
| `world.ts`      | Live object lists: adding spawned batches, culling, the surface under the rider, ramp crossing (`WorldLists`, `addBatch`, `cullAbove`, `surfaceAt`, `takeRamp`).               |
| `collision.ts`  | Hitbox overlap tests and near-miss rules. `isPebble` / `PEBBLE_SIZE`: rocks below it never collide, and the renderer draws them flat by the same rule.                         |
| `score.ts`      | Points, combos, near-miss rewards.                                                                                                                                             |
| `trail.ts`      | Fixed-size ring buffer of board positions (allocation-free).                                                                                                                   |
| `spawner.ts`    | Deterministic endless course generator (trees, rocks, lane stars, kickers, ice, drifts, risk lanes) with a guaranteed-open path.                                               |
| `types.ts`      | Obstacle and patch type definitions shared by spawner, collision and render.                                                                                                   |

## Rules

- Imports only `../core`. Never the DOM, `window`, storage, audio, `render/` or `state/`.
- No `Math.random`, `Date.now` or any time source. Use `core/rng.ts` streams.
- Any rule change must keep `tests/sim.test.ts` and `tests/spawner.test.ts` green. The world fingerprints in `tests/spawner.test.ts` must never be refreshed casually: a changed course breaks shared seed links and per-seed boards.
- Same seed gives the same course in every browser: everything the spawner computes, including `cruiseSpeed` and `topSpeed` in `speed.ts`, uses `core/detMath.ts` or exact operations (`+ - * /`, `round`, `floor`, `min`, `max`, `abs`). Never use `Math.exp`, `sin`, `pow` and the like in that path.
- Flip naming: code comments and signs call positive pitch a backflip, but `flipName` in `score.ts` deliberately shows the opposite on screen: positive is "FRONTFLIP" and negative is "BACKFLIP". Only the displayed text is swapped.
- Rider physics keeps `Math.*` (`sin`, `cos`, `exp`, `atan2`), deliberately. The course cannot depend on it: `Spawner` takes only a seed and a target y, never rider state, and the only rider code it reaches is `speed.ts` (`cruiseSpeed`, `topSpeed`, `airTime`, `maxFlightPx`), which is exact. Math.* in `rider.ts`, `tricks.ts` and `pose.ts` cannot reach the course. A full run is repeatable in one engine but not guaranteed bit-identical across browsers, and nothing needs that since the ghost was removed. If a feature ever replays a run across devices, this has to change first.
- `tests/e2e/course.spec.ts` proves the course guarantee in real Chromium, Firefox and WebKit. Any new spawner code runs under it, so a non-exact call in that path fails the suite.
- `spawner.ts` imports `speed.ts`, never `rider.ts`, `tricks.ts` or `pose.ts`. Keep it that way: it is what keeps the course path exact.
- Jumps are planned from the `config.ts` spacing (a lip every 1000-1300 px plus up to 100 px, about every 150 m). Their fairness rules, checked in `tests/spawner.test.ts`: a solid-free landing zone across the whole slope sized for top speed plus `LANDING_MARGIN`; a jump that would overlap a risk lane (with `LANE_JUMP_PAD`) is moved past the lane, never dropped; ice and drifts stay `JUMP_PATCH_PAD` plus their radius from every lip (`planPatches` plans ramps first so this does not depend on chunking); the gap between jumps is always longer than the longest landing zone; a kicker is never wider than the open path.
- Stance: `RiderState.stance` is 1 regular or -1 switch, and every run starts regular. A clean or sloppy landing after an odd number of half turns swaps it (a bail does not). It changes only how the rider is drawn: steering, collisions and the board's track are the same either way, and the half-turn speed bonus (+10 instead of +16) still depends on the spin, not the stance. `LandEvent.switch` is true when the rider rides away switch. A spin keeps the takeoff stance in its pose all the way round, so the frame it ends on already shows the side he lands on.
- Import each name from the file that defines it. There is no barrel file.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
