import type { Sfx } from '../platform/audio';
import type { Tracker } from '../platform/analytics';
import { LESSON_GUARD, RIDER_SCREEN_Y, RIDER_SCREEN_Y_FAST, START_Y } from '../core/config';
import { BrakeSpray, CarveCloud, Particles, Puffs } from './effects';
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
import { runEndEvent, runStartEvent, type RunSetup } from './telemetry';
import type { GameView } from './view';
import { lessonLines, lessonSeen, markSeen, nextLesson, tutorialOn, type Lesson } from './tutorial';

export interface GameDeps {
  store: Store;
  input: Input;
  sfx: Sfx;
  /** Vibrate for a number of milliseconds (touch phones only). */
  haptic?: (ms: number) => void;
  announce?: (text: string) => void;
  /** Render and share the result card. Resolves to a short message to show the player. */
  share?: (card: ResultCardData) => Promise<string>;
  now?: () => Date;
  /** Cosmetic randomness only (particles). Never feeds the sim. */
  rand?: () => number;
  /** Anonymous analytics (see `state/telemetry.ts`). Fire and forget: never throws, never waits. */
  analytics?: Tracker;
}

/** Ignore restart presses for this long after the game over panel appears. */
const RESTART_GUARD = 0.5;

/** The shell around the sim: runs and their phases, the camera, and what each frame steps. */
export class Game implements GameView {
  phase: Phase = 'title';
  seed = '';
  sim!: Sim;
  result: RunResult | null = null;
  /** The tutorial lesson stopping the run right now (see `state/tutorial.ts`), or null. */
  lesson: Lesson | null = null;
  /** Seconds the current lesson has been up. */
  private lessonT = 0;

  readonly particles = new Particles(512);
  readonly puffs = new Puffs();
  private camY = 0;
  /**
   * The camera and the rider as they were before the latest step, and how far the screen's moment lies between that
   * step and the next one (0 to 1). The screen draws in between, so motion stays even whatever the display's refresh
   * rate: at 90 Hz the 120 Hz steps land 1, 1, 2 per frame, which made the slope lurch every third frame.
   */
  private prevCamY = 0;
  private prevRiderX = 0;
  private prevRiderY = 0;
  private blendAlpha = 1;
  private camOff = RIDER_SCREEN_Y;
  /** Seconds the world has been animating (stops while paused). */
  animT = 0;
  private overAt = 0;
  private readonly controls: Controls;
  private readonly feedback: Feedback;
  private readonly spray = new BrakeSpray();
  private readonly cloud = new CarveCloud();
  private sharing = false;
  /** Runs started since the page loaded, for the second-run rate. Never stored. */
  private runsStarted = 0;

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

  get scoreTab(): 'top' | 'daily' {
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

  /** Where the screen should be drawn between the last two steps (see `prevCamY`). Called before every render. */
  setBlend(alpha: number): void {
    this.blendAlpha = Math.min(1, Math.max(0, alpha));
  }

  /** The camera at the screen's moment, in fractional pixels. */
  private get camView(): number {
    return this.prevCamY + (this.camY - this.prevCamY) * this.blendAlpha;
  }

  /** The camera's whole pixel: the world is drawn from this row. */
  get camYi(): number {
    return Math.floor(this.camView);
  }

  /** The rest of the camera, 0 to 1: the page slides the slope up this much of a pixel for a smooth scroll. */
  get camFrac(): number {
    return this.camView - this.camYi;
  }

  /** The rider's board tail at the screen's moment, for drawing him in step with the camera. */
  get riderX(): number {
    return this.prevRiderX + (this.sim.rider.x - this.prevRiderX) * this.blendAlpha;
  }

  get riderY(): number {
    return this.prevRiderY + (this.sim.rider.y - this.prevRiderY) * this.blendAlpha;
  }

  /** Forget the previous step, after a jump cut such as a new run. */
  private settleBlend(): void {
    this.prevCamY = this.camY;
    this.prevRiderX = this.sim.rider.x;
    this.prevRiderY = this.sim.rider.y;
  }

  /** Best score ever. */
  get overallBest(): number {
    return this.deps.store.overallBest();
  }

  get dailyBest(): number {
    return this.deps.store.dailyBest(this.today);
  }

  get topRuns(): readonly ScoreEntry[] {
    return this.deps.store.topRuns();
  }

  get dailyRuns(): readonly ScoreEntry[] {
    return this.deps.store.dailyRuns(this.today);
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

  /** The rider is in the air (for the touch grab). */
  get airborne(): boolean {
    return this.sim.rider.air;
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
    this.sim = new Sim(seed, { manualSpin: this.settings.manualSpin });
    this.particles.clear();
    this.puffs.clear();
    this.feedback.reset();
    this.spray.reset();
    this.cloud.reset();
    this.camOff = RIDER_SCREEN_Y;
    this.camY = this.sim.rider.y - this.camOff;
    this.settleBlend();
    this.result = null;
    this.lesson = null;
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
    this.deps.announce?.('Run started.');
    this.runsStarted++;
    this.deps.analytics?.track(runStartEvent(this.runsStarted, this.runSetup()));
    const stats = this.progress.stats;
    if (tutorialOn(stats) && !lessonSeen(stats.lessons, 'steer')) {
      this.showLesson({ id: 'steer', lines: lessonLines('steer', this.touch), target: null });
    }
  }

  /** Stop the run on a lesson, and remember it was shown. */
  private showLesson(lesson: Lesson): void {
    this.lesson = lesson;
    this.lessonT = 0;
    const p = this.deps.store.progress();
    p.stats.lessons = markSeen(p.stats.lessons, lesson.id);
    this.deps.store.saveProgress();
    this.deps.input.releaseAll();
    this.deps.announce?.(`${lesson.lines.join('. ').toLowerCase()}.`);
  }

  /** Go on from a lesson, once it has been up long enough to have been read. */
  dismissLesson(): void {
    if (this.lesson && this.lessonT >= LESSON_GUARD) this.lesson = null;
  }

  /** How this run is played, for analytics. */
  private runSetup(): RunSetup {
    return { kit: this.progress.gear.kit, color: this.settings.color, daily: this.daily };
  }

  update(dt: number): void {
    this.settleBlend();
    this.controls.handleInput();
    if (this.lesson && this.phase === 'playing') {
      // The run holds still under a lesson: nothing steps, nothing animates.
      this.lessonT += dt;
    } else if (this.feedback.hitStop > 0) {
      this.animT += dt;
      this.feedback.coolHitStop(dt);
      this.feedback.stepToasts(dt);
    } else {
      if (this.phase !== 'paused') this.animT += dt;
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
        this.puffs.step(dt);
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
      active: this.phase === 'playing' && this.feedback.hitStop <= 0 && !this.lesson,
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
    return this.result && toCard(this.result, this.progress.gear.kit === 'skis');
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
    const rand = this.deps.rand ?? Math.random;
    this.spray.step(sim.rider, this.particles, rand);
    this.cloud.step(sim.rider, this.puffs, this.particles, rand);
    if (sim.crashed) {
      this.phase = 'crashed';
      return;
    }
    const stats = this.progress.stats;
    if (tutorialOn(stats)) {
      const lesson = nextLesson(sim, stats.lessons, this.touch);
      if (lesson) this.showLesson(lesson);
    }
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
    this.deps.analytics?.track(runEndEvent(res.dist, res.score, this.runsStarted, this.runSetup()));
    this.deps.announce?.(
      `${this.crashWord}. ${res.dist} metres, score ${res.score}${res.newBest ? ', a new best' : ''}.`,
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
