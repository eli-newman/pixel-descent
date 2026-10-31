import type { Sim, SimInput } from '../../src/sim/sim';

/**
 * A simple path follower: aim at the centre of the guaranteed open path a little way ahead,
 * and fly straight through the air. Used to check that the open path stays winnable.
 */
export function botInput(sim: Sim, lookScale = 0.2): SimInput {
  const r = sim.rider;
  if (r.air) return { steer: 0, trick: false };
  const look = 14 + r.speed * lookScale;
  const tx = sim.spawner.pathCenter(r.y + 8 + look);
  const err = tx - r.x;
  const steer = Math.max(-1, Math.min(1, err / (look * 0.55) - r.hv * 0.04));
  return { steer, trick: false };
}

/** Run a bot until it crashes or reaches a distance. Returns the sim. */
export function runBot(
  sim: Sim,
  metres: number,
  pick: (sim: Sim) => SimInput = botInput,
  maxSteps = 400_000,
): Sim {
  sim.begin();
  for (let i = 0; i < maxSteps && !sim.crashed && sim.distM < metres; i++) sim.step(pick(sim));
  return sim;
}
