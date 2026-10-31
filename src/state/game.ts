import type { Sfx } from '../platform/audio';
import { RIDER_SCREEN_Y, RIDER_SCREEN_Y_FAST, START_Y } from '../core/config';
import { BrakeSpray, Particles } from './effects';
import type { Input } from '../platform/input';
import { Controls } from './controls';
import { Feedback, type Toast } from './feedback';
import type { ButtonId, Phase, Screen } from './menu';
import { ACHIEVEMENTS, boardIndex, riderIndex } from './progress';
import { dailySeed, isDailySeed, normalizeSeed, randomSeedString } from '../core/rng';
import { dayString, recordRun, summarizeRun, toCard, type RunResult } from './runReport';
import { Sim } from '../sim/sim';
import type { ResultCardData } from '../render/share';
import type { ScoreEntry, Store } from './storage';
import type { GameView } from './view';

export interface GameDeps {
  store: Store;
  input: Input;
  sfx: Sfx;
  /** Vibrate for a number of milliseconds (touch phones only). */
  haptic?: (ms: number) => void;
  onSeed?: (seed: string) => void;
  announce?: (text: string) => void;
  /** Render and share the result card. Resolves to a short message to show the player. */
  share?: (card: ResultCardData) => Promise<string>;
  now?: () => Date;
  /** Cosmetic randomness only (particles). Never feeds the sim. */
  rand?: () => number;
}

/** Ignore restart presses for this long after the game over panel appears. */
const RESTART_GUARD = 0.5;

/** The shell around the sim: runs and their phases, the camera, and what each frame steps. */
export class Game implements GameView {
  phase: Phase = 'title';
  seed = '';
  sim!: Sim;
  result: RunResult | null = null;

  readonly particles = new Particles(512);
  private camY = 0;
  private camOff = RIDER_SCREEN_Y;
  /** Seconds the world has been animating (stops while paused). */
  animT = 0;
  private overAt = 0;
  private readonly controls: Controls;
  private readonly feedback: Feedback;
  private readonly spray = new BrakeSpray();
  private sharing = false;

  constructor(
    private readonly deps: GameDeps,
    initialSeed?: string | null,
  ) {
    this.controls = new Controls(this, deps);
    this.feedback = new Feedback(deps.sfx, (ms) => {
      if (this.settings.haptics) deps.haptic?.(ms);
    });
    deps.sfx.setMuted(this.settings.muted);
    deps.sfx.setMusic(this.settings.music);
    this.newRun(normalizeSeed(initialSeed) ?? randomSeedString());
  }

  get screen(): Screen {
    return this.controls.screen;
  }

  get scoreTab(): 'seed' | 'daily' {
    return this.controls.scoreTab;
  }

  get focus(): number {
    return this.controls.focus;
  }

  get focusVisible(): boolean {
    return this.controls.focusVisible;
  }

  get toasts(): readonly Toast[] {
    return this.feedback.toasts;
  }

  /** Seconds the simulation stays frozen after an impact. */
  get hitStop(): number {
    return this.feedback.hitStop;
  }

  get settings(): ReturnType<Store['settings']> {
    return this.deps.store.settings();
  }

  get progress(): ReturnType<Store['progress']> {
    return this.deps.store.progress();
  }

  get today(): string {
    return dailySeed(this.deps.now?.() ?? new Date());
  }

  /** Camera y snapped to a whole pixel, so the scene scrolls in crisp one pixel steps. */
  get camYi(): number {
    return Math.round(this.camY);
  }

  /** Best score on this seed. */
  get seedBest(): number {
    return this.deps.store.seedBest(this.seed);
  }

  /** Best score over all seeds. */
  get overallBest(): number {
    return this.deps.store.overallBest();
  }

  bestOn(seed: string): number {
    return this.deps.store.seedBest(seed);
  }

  leaderboard(seed: string): readonly ScoreEntry[] {
    return this.deps.store.leaderboard(seed);
  }

  get daily(): boolean {
    return isDailySeed(this.seed);
  }

  get touch(): boolean {
    return this.deps.input.usingTouch;
  }

  /** The game over panel has been up long enough to accept a restart. */
  get overReady(): boolean {
    return this.animT - this.overAt > RESTART_GUARD;
  }

  /** Short headline for the game over screen. */
  get crashWord(): string {
    return this.sim.crashCause === 'bail' ? 'BAILED' : 'WIPEOUT';
  }

  /** Total achievements earned, for the title screen. */
  get achievementCount(): number {
    return ACHIEVEMENTS.filter((a) => this.progress.achievements[a.id] !== undefined).length;
  }

  get boardIdx(): number {
    return boardIndex(this.progress.gear.board);
  }

  get riderIdx(): number {
    return riderIndex(this.progress.gear.rider);
  }

  /** Reset the world for a seed and wait on the title screen (or go straight in if `play`). */
  newRun(seed: string, play = false): void {
    this.seed = seed;
    this.deps.onSeed?.(seed);
    this.sim = new Sim(seed, { manualSpin: this.settings.manualSpin });
    this.particles.clear();
    this.feedback.reset();
    this.spray.reset();
    this.camOff = RIDER_SCREEN_Y;
    this.camY = this.sim.rider.y - this.camOff;
    this.result = null;
    this.phase = 'title';
    this.controls.reset();
    if (play) this.begin();
  }

  begin(): void {
    if (this.phase !== 'title') return;
    this.phase = 'playing';
    this.sim.begin();
    this.deps.input.releaseAll();
    this.deps.sfx.start();
    this.deps.announce?.(`Run started. Seed ${this.seed}.`);
  }

  update(dt: number): void {
    this.controls.handleInput();
    if (this.phase !== 'paused') this.animT += dt;
    if (this.feedback.hitStop > 0) {
      this.feedback.coolHitStop(dt);
      this.feedback.stepToasts(dt);
    } else {
      switch (this.phase) {
        case 'playing':
          this.stepPlaying();
          break;
        case 'crashed':
          this.stepCrashed();
          break;
        default:
          break;
      }
      if (this.phase !== 'paused') {
        this.particles.step(dt);
        this.feedback.stepToasts(dt);
      }
    }
    this.updateCamera(dt);
    const sim = this.sim;
    const r = sim.rider;
    this.deps.sfx.ride({
      speed: r.speed,
      hv: r.hv,
      hx: r.hx,
      tuck: sim.tuck,
      air: r.air,
      active: this.phase === 'playing' && this.feedback.hitStop <= 0,
      ice: sim.surface.ice,
      drift: sim.surface.drift,
      brake: r.brake,
    });
  }

  /** Run the action behind a button. */
  press(id: ButtonId): void {
    this.controls.press(id);
  }

  /** Pause when the page loses focus so a run never plays on while hidden. */
  autoPause(force = false): void {
    if (this.phase === 'playing' && (force || this.settings.autoPause)) this.togglePause();
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.deps.input.releaseAll();
      this.controls.resetFocus();
      this.deps.announce?.('Paused.');
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.deps.announce?.('Resumed.');
    }
  }

  /** The spin mode is part of the run's rules: it can change only before the run starts. */
  setManualSpin(on: boolean): void {
    if (this.phase === 'title') this.sim.opts.manualSpin = on;
  }

  /** The result of this run, for the share card and tests. */
  cardData(): ResultCardData | null {
    return this.result && toCard(this.result);
  }

  /** Render and share the result card; shows the outcome as a toast. */
  async share(): Promise<void> {
    const card = this.cardData();
    if (!card || !this.deps.share || this.sharing) return;
    this.sharing = true;
    try {
      this.feedback.showToast(await this.deps.share(card), 2.2, true);
    } catch {
      this.feedback.showToast('SHARE FAILED', 2, false);
    } finally {
      this.sharing = false;
    }
  }

  private stepPlaying(): void {
    const sim = this.sim;
    sim.step(this.controls.readSimInput());
    for (const e of sim.events) this.feedback.react(e, this.animT);
    this.spray.step(sim.rider, this.particles, this.deps.rand ?? Math.random);
    if (sim.crashed) this.phase = 'crashed';
  }

  private stepCrashed(): void {
    this.sim.step(this.controls.simInput);
    if (this.sim.finished) this.finish();
  }

  private finish(): void {
    this.phase = 'over';
    this.overAt = this.animT;
    this.controls.resetFocus();
    const summary = summarizeRun(this.sim, this.seed, this.daily);
    const day = dayString(this.deps.now?.() ?? new Date());
    const res = recordRun(this.deps.store, summary, day);
    this.result = res;
    this.deps.announce?.(
      `${this.crashWord}. ${res.dist} metres, score ${res.score}${res.newSeedBest ? ', a new best for this seed' : ''}.`,
    );
  }

  private updateCamera(dt: number): void {
    const sim = this.sim;
    if (this.phase === 'title') {
      this.camOff = RIDER_SCREEN_Y;
      this.camY = sim.rider.y - this.camOff;
      return;
    }
    if (this.phase !== 'playing') return;
    const target = RIDER_SCREEN_Y + (RIDER_SCREEN_Y_FAST - RIDER_SCREEN_Y) * sim.tuck;
    this.camOff += (target - this.camOff) * Math.min(1, 2.5 * dt);
    this.camY = Math.max(START_Y - RIDER_SCREEN_Y, sim.rider.y - this.camOff);
  }
}
