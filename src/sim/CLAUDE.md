# src/sim

The rules of the game as pure, deterministic code. Feed a seed and inputs at the fixed step and it always plays the same run. The live game and the tests both run it.

| File            | Job                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sim.ts`        | `Sim` class: one world step (`step(input, dt)`), emits `events` (crash, star, trick, ...). The hub of this folder.                                                             |
| `rider.ts`      | `stepRider`: heading spring, braking, movement, slope walls. Also `launch`, `riderZ`, `headingY`, `headingAngle`.                                                              |
| `riderState.ts` | `RiderState`, `Surface`, `Face`, `createRider`. Types and the starting state only.                                                                                             |
| `speed.ts`      | The speed model: `cruiseSpeed`, `topSpeed`, tuck and scrub (`stepSpeed`), air time and flight distance. The spawner's only rider dependency, so it must stay exact arithmetic. |
| `tricks.ts`     | Spins and flips: assisted and manual stepping, caps, `startTrick`/`startSnap`/`startFlip`, landing tolerances.                                                                 |
| `pose.ts`       | `RiderPose` and `poseOf`: what the renderer needs to draw the rider.                                                                                                           |
| `landing.ts`    | `touchDown`: judges a landing (clean, sloppy, bail), pays the score, returns the `LandEvent`.                                                                                  |
| `world.ts`      | Live object lists: adding spawned batches, culling, the surface under the rider, ramp crossing (`WorldLists`, `addBatch`, `cullAbove`, `surfaceAt`, `takeRamp`).               |
| `collision.ts`  | Hitbox overlap tests and near-miss rules.                                                                                                                                      |
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
- Import each name from the file that defines it. There is no barrel file.

## Keeping docs in sync (mandatory)

When you change anything in this folder (add, remove, rename a file, change an exported function, constant or rule), update this file in the same change. Update the root `CLAUDE.md` too if the layout or dependency rules move, and `README.md` if player-facing behavior or paths change.
