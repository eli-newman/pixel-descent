import { describe, expect, it } from 'vitest';
import { menuButtons } from '../src/menu';
import { dailySeed } from '../src/rng';
import { makeGame, stepUntil } from './helpers/fakes';

describe('game state machine', () => {
  it('walks title, playing, paused, playing', () => {
    const { game, input } = makeGame();
    expect(game.phase).toBe('title');
    input.push('start');
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    input.push('pause');
    game.update(1 / 120);
    expect(game.phase).toBe('paused');
    const y = game.sim.rider.y;
    for (let i = 0; i < 60; i++) game.update(1 / 120);
    expect(game.sim.rider.y).toBe(y);
    input.push('start');
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
  });

  it('crashes, tumbles, then shows the game over screen and records the score', () => {
    const { game, input, store } = makeGame('crashy');
    input.push('start');
    stepUntil(game, () => game.phase === 'crashed');
    expect(game.phase).toBe('crashed');
    stepUntil(game, () => game.phase === 'over');
    expect(game.phase).toBe('over');
    expect(game.result).not.toBeNull();
    expect(store.leaderboard('crashy')[0]?.score).toBe(game.result?.score);
    expect(store.overallBest()).toBe(game.result?.score);
    expect(game.result?.rank).toBe(1);
    expect(game.result?.newSeedBest).toBe(true);
  });

  it('freezes the simulation, not the clock, during hit-stop', () => {
    const { game, input } = makeGame('hitstop');
    input.push('start');
    stepUntil(game, () => game.sim.crashed);
    expect(game.hitStop).toBeGreaterThan(0);
    const steps = game.sim.steps;
    const anim = game.animT;
    game.update(1 / 120);
    expect(game.sim.steps).toBe(steps);
    expect(game.animT).toBeGreaterThan(anim);
    stepUntil(game, () => game.hitStop === 0, 200);
    game.update(1 / 120);
    expect(game.sim.steps).toBeGreaterThan(steps);
  });

  it('ignores restart presses right after the game over panel appears', () => {
    const { game, input } = makeGame('guard');
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    input.push('start');
    input.push('share');
    game.update(1 / 120);
    expect(game.phase).toBe('over');
    for (let i = 0; i < 100; i++) game.update(1 / 120);
    input.tap(5, 5);
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    expect(game.seed).not.toBe('guard');
  });

  it('retry keeps the seed, new run picks another', () => {
    const { game, input } = makeGame('same');
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    input.push('retry');
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    expect(game.seed).toBe('same');
  });

  it('plays the daily seed from the button', () => {
    const { game, input } = makeGame('x');
    const play = menuButtons(game).find((b) => b.id === 'daily');
    expect(play).toBeDefined();
    input.tap((play?.x ?? 0) + 3, (play?.y ?? 0) + 3);
    game.update(1 / 120);
    expect(game.phase).toBe('playing');
    expect(game.seed).toBe(dailySeed(new Date(2026, 9, 20)));
    expect(game.seed).toBe('d20261020');
  });

  it('keeps best scores per seed as well as overall', () => {
    const { game, input, store } = makeGame('seeda');
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    const a = store.seedBest('seeda');
    expect(a).toBeGreaterThan(0);
    expect(store.seedBest('seedb')).toBe(0);
    expect(game.seedBest).toBe(a);
    game.newRun('seedb');
    expect(game.seedBest).toBe(0);
    expect(game.overallBest).toBe(a);
  });

  it('remembers mute and settings between sessions', () => {
    const rig = makeGame();
    rig.input.push('mute');
    rig.game.update(1 / 120);
    expect(rig.sfx.muted).toBe(true);
    rig.input.push('hud');
    rig.game.update(1 / 120);
    const again = makeGame('r2', {}, rig.storage);
    expect(again.sfx.muted).toBe(true);
    expect(again.game.settings.bigHud).toBe(true);
  });

  it('shares the result card from the game over screen', async () => {
    const { game, input, shared } = makeGame('shareme');
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    for (let i = 0; i < 100; i++) game.update(1 / 120);
    input.push('share');
    game.update(1 / 120);
    await Promise.resolve();
    await Promise.resolve();
    expect(shared).toHaveLength(1);
    expect((shared[0] as { seed: string }).seed).toBe('shareme');
  });

  it('records a ghost for a new seed best and loads it next time', () => {
    const rig = makeGame('ghosty');
    rig.input.push('start');
    stepUntil(rig.game, () => rig.game.phase === 'over');
    expect(rig.store.ghost('ghosty')).not.toBeNull();
    rig.game.newRun('ghosty');
    expect(rig.game.ghost).not.toBeNull();
    // the ghost replays the saved run exactly
    rig.input.push('start');
    stepUntil(rig.game, () => rig.game.phase === 'over');
    const ghost = rig.game.ghost;
    const saved = rig.store.ghost('ghosty');
    expect(ghost).not.toBeNull();
    expect(ghost?.scoreValue).toBe(saved?.score);
  });

  it('keeps reduced motion free of shake and punch', () => {
    const { game, input } = makeGame('calm', { reducedMotion: () => true });
    input.push('start');
    stepUntil(game, () => game.phase === 'over');
    expect(game.shake).toBe(0);
    expect(game.punch).toBe(0);
    expect(game.particles.count).toBe(0);
  });
});
