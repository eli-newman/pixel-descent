import type { Sfx } from '../platform/audio';
import type { AnalyticsEvent, Tracker } from '../platform/analytics';
import type { ShareVia } from '../platform/shareDom';
import type { Dare } from '../core/dare';
import {
  LESSON_EASE_IN,
  LESSON_EASE_OUT,
  LESSON_GUARD,
  RIDER_SCREEN_Y,
  RIDER_SCREEN_Y_FAST,
  START_Y,
  STEP,
} from '../core/config';
import { BrakeSpray, CarveCloud, Particles, Puffs } from './effects';
import type { Input } from '../platform/input';
import { Controls } from './controls';
import { Feedback, type Toast } from './feedback';
import type { ButtonId, Phase, Screen } from './menu';
import { ACHIEVEMENTS, boardIndex, riderIndex } from './progress';
import { dailySeed, isDailySeed, normalizeSeed } from '../core/rng';
import { dayString, recordRun, runEnd, summarizeRun, toCard, type RunResult } from './runReport';
import { Sim } from '../sim/sim';
import type { ScoreEntry, Store } from './storage';
import {
  bestBand,
  dareOutcome,
  dareResultEvent,
  dayActiveEvent,
  lessonDoneEvent,
  lessonShownEvent,
  nextActionEvent,
  runEndedEvent,
  runMode,
  runSharedEvent,
  runStartedEvent,
  tutorialEndedEvent,
  unlockEarnedEvent,
  withContext,
  type NextAction,
  type RunEnd,
  type RunSetup,
} from './telemetry';
import type { GameView } from './view';
import {
  ALL_LESSONS,
  freshSeed,
  lessonReadyAt,
  markSeen,
  nextLesson,
  tutorialOn,
  type Lesson,
} from './tutorial';

export interface GameDeps {
  store: Store;
  input: Input;
  sfx: Sfx;
  /** Vibrate for a number of milliseconds (touch phones only). */
  haptic?: (ms: number) => void;
  announce?: (text: string) => void;
  /** Share a run as a dare (link and card). Resolves to a short message to show the player. */
  share?: (card: Dare) => Promise<string>;
  now?: () => Date;
  /** Cosmetic randomness only (particles). Never feeds the sim. */
  rand?: () => number;
  /** Anonymous analytics (see `state/telemetry.ts`). Fire and forget: never throws, never waits. */
  analytics?: Tracker;
  /** This visit opened from a shared link (a dare, a broken one, or an old `?seed=` link): analytics `source`. */
  fromShare?: boolean;
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
  /**
   * The friend's run this player is trying to beat, from the dare link they opened, or null. It holds while they
   * stay on its course (RETRY, RESTART) and ends on any other course.
   */
  dare: Dare | null = null;
  /** Seconds the current lesson has been up. */
  private lessonT = 0;
  /**
   * Seconds since the player went on from the current lesson, or null while it is still up. The lesson stays (its
   * words fading out) until the run is back to full speed.
   */
  private lessonOutT: number | null = null;
  /** When the last lesson of this run went, in seconds of the run, or null. Spaces lessons out (`LESSON_GAP`). */
  private lessonEnd: number | null = null;
  /**
   * Under a lesson the run slows down and stops: each frame adds its share of a sim step here, and the sim steps
   * when it reaches one. Every step is the same fixed step, so the run is the same, only slower.
   */
  private slowAcc = 0;

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
  /** Runs started since the page loaded, for analytics. Never stored. */
  private runsStarted = 0;
  /** Analytics about the current run: which run of the player's life it is, and whether its end was sent yet. */
  private lifeRun = 0;
  private runLive = false;
  /** The tutorial was on when this run started (so the run that ends it can say so). */
  private tutorialAtStart = false;
  private tutorialEndSent = false;
  /** Runs at the current dare in this visit. */
  private dareTries = 0;
  /** What the player has done from this game over screen, so each action is sent once. */
  private nextSent = new Set<NextAction>();
  /** The local day of the last analytics event, so the first one of each day is preceded by Day Active. */
  private activeDay = '';
  /** Nothing was saved before this visit: analytics `player` is "new" for the whole visit. */
  private readonly newPlayer: boolean;

  constructor(
    private readonly deps: GameDeps,
    initialSeed?: string | null,
    dare?: Dare | null,
  ) {
    this.controls = new Controls(this, deps);
    this.feedback = new Feedback(deps.sfx, (ms) => {
      if (this.settings.haptics) deps.haptic?.(ms);
    });
    deps.sfx.setMuted(this.settings.muted);
    deps.sfx.setMusic(this.settings.music);
    this.newPlayer = this.progress.stats.runs === 0;
    this.dare = dare ?? null;
    this.newRun(dare?.seed ?? normalizeSeed(initialSeed) ?? this.freshSeed());
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

  /** How far the screen's moment lies from the step before the latest to the latest, slowed under a lesson. */
  private get blend(): number {
    if (!this.lesson) return this.blendAlpha;
    return Math.min(1, this.slowAcc + this.blendAlpha * this.lessonScale);
  }

  /** The camera at the screen's moment, in fractional pixels. */
  private get camView(): number {
    return this.prevCamY + (this.camY - this.prevCamY) * this.blend;
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
    return this.prevRiderX + (this.sim.rider.x - this.prevRiderX) * this.blend;
  }

  get riderY(): number {
    return this.prevRiderY + (this.sim.rider.y - this.prevRiderY) * this.blend;
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
    // A run left before game over (QUIT, MENU, RESTART, RETRY while it tumbles) still ends.
    this.endLiveRun(this.phase === 'crashed' ? 'crash' : 'quit');
    this.nextSent.clear();
    if (this.dare && this.dare.seed !== seed) {
      this.dare = null;
      this.dareTries = 0;
    }
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
    this.lessonOutT = null;
    this.lessonEnd = null;
    this.slowAcc = 0;
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
    const stats = this.progress.stats;
    this.runsStarted++;
    this.lifeRun = stats.runs + 1;
    this.runLive = true;
    this.tutorialAtStart = tutorialOn(stats);
    if (this.dare) this.dareTries++;
    this.track(runStartedEvent(this.runSetup(), this.lifeRun, this.runsStarted));
  }

  /**
   * Send an analytics event with who is playing (`withContext`). The first event of each local day goes after a Day
   * Active. `main.ts` sends its own events (the page loading, sessions) through here too.
   */
  track(e: AnalyticsEvent): void {
    const analytics = this.deps.analytics;
    if (!analytics) return;
    const today = this.day();
    const context = {
      player: this.newPlayer ? ('new' as const) : ('returning' as const),
      firstDay: this.progress.stats.firstDay,
      today,
      source: this.deps.fromShare ? ('dare' as const) : ('direct' as const),
    };
    if (this.activeDay !== today) {
      this.activeDay = today;
      analytics.track(withContext(dayActiveEvent(context.firstDay, today), context));
    }
    analytics.track(withContext(e, context));
  }

  /** Runs started since the page loaded (analytics sessions count them). */
  get visitRuns(): number {
    return this.runsStarted;
  }

  /** The page is going away (`pagehide`): a run still going ends as left. */
  leave(): void {
    this.endLiveRun('left');
  }

  /** The player shared this run, and how. */
  trackShare(via: ShareVia): void {
    const res = this.result;
    const dare = this.dare && res ? dareOutcome(res.score, this.dare.score) : 'none';
    this.track(runSharedEvent(via, runMode(this.runSetup()), dare));
  }

  /** What the player did from the game over screen (from `Controls`). Each action is sent once per screen. */
  noteNext(action: NextAction): void {
    if (this.phase !== 'over' || this.nextSent.has(action)) return;
    this.nextSent.add(action);
    this.track(nextActionEvent(action));
  }

  /** Run Ended for a run that stopped before game over. */
  private endLiveRun(end: RunEnd): void {
    if (!this.runLive) return;
    this.runLive = false;
    const sim = this.sim;
    const best = this.overallBest;
    this.track(
      runEndedEvent({
        end,
        cause: sim.crashed ? runEnd(sim.crashCause, sim.killer?.kind ?? null) : 'none',
        metres: sim.distM,
        best: bestBand(sim.scoreValue, best, false),
        setup: this.runSetup(),
        lifeRun: this.lifeRun,
      }),
    );
    this.checkTutorialEnd();
  }

  /**
   * Tutorial Ended, once, from the run in which the tutorial stopped: "completed" when every lesson has been shown,
   * "cut_short" when the tutorial runs ran out first. Checked when a lesson is gone on from and when a run ends.
   */
  private checkTutorialEnd(): void {
    const stats = this.progress.stats;
    if (this.tutorialEndSent || !this.tutorialAtStart || tutorialOn(stats)) return;
    this.tutorialEndSent = true;
    this.track(tutorialEndedEvent(stats.lessons === ALL_LESSONS ? 'completed' : 'cut_short'));
  }

  /** Today as a local `YYYY-MM-DD`. */
  private day(): string {
    return dayString(this.deps.now?.() ?? new Date());
  }

  /** The course a new run starts on: the tutorial's own while it has lessons left (`freshSeed`). */
  freshSeed(): string {
    return freshSeed(this.progress.stats);
  }

  /** Slow the run to a stop on a lesson, and remember it was shown. */
  private showLesson(lesson: Lesson): void {
    this.lesson = lesson;
    this.lessonT = 0;
    this.lessonOutT = null;
    this.slowAcc = 0;
    const p = this.deps.store.progress();
    p.stats.lessons = markSeen(p.stats.lessons, lesson.id);
    this.deps.store.saveProgress();
    this.deps.input.releaseAll();
    this.deps.announce?.(`${[lesson.title, ...lesson.lines].join('. ').toLowerCase()}.`);
    this.track(lessonShownEvent(lesson.id, p.stats.runs));
  }

  /** Go on from a lesson, once it has been up long enough to have been read: the run picks up speed again. */
  dismissLesson(): void {
    if (!this.lesson || !this.lessonWaiting || this.lessonT < LESSON_GUARD) return;
    this.lessonOutT = 0;
    this.track(lessonDoneEvent(this.lesson.id, this.progress.stats.runs));
    this.checkTutorialEnd();
  }

  /** A lesson is up and has not been gone on from: taps and keys go to it. */
  get lessonWaiting(): boolean {
    return this.lesson !== null && this.lessonOutT === null;
  }

  get lessonReady(): boolean {
    return this.lessonWaiting && this.lessonT >= LESSON_GUARD;
  }

  get lessonAge(): number {
    return this.lesson ? this.lessonT : 0;
  }

  /** How far the lesson's words have faded in: with the run slowing down, and out with it speeding up. */
  get lessonShow(): number {
    if (!this.lesson) return 0;
    if (this.lessonOutT !== null) return 1 - Math.min(1, this.lessonOutT / LESSON_EASE_OUT);
    return Math.min(1, this.lessonT / LESSON_EASE_IN);
  }

  /** The share of full speed the run goes at under a lesson: easing down to 0, then back up to 1. */
  private get lessonScale(): number {
    if (!this.lesson) return 1;
    return 1 - smoothstep(this.lessonShow);
  }

  /** How this run is played, for analytics. */
  private runSetup(): RunSetup {
    return {
      kit: this.progress.gear.kit,
      daily: this.daily,
      dare: this.dare !== null,
      tutorial: this.tutorialAtStart,
    };
  }

  update(dt: number): void {
    this.controls.handleInput();
    if (this.lesson && this.phase === 'playing') {
      // Under a lesson the world runs slower, then stops, then picks up again: it steps only when a whole step has
      // built up, and the screen draws between steps by the same measure (`blend`).
      this.stepLesson(dt);
      this.slowAcc += this.lessonScale;
      if (this.slowAcc >= 1) {
        this.slowAcc -= 1;
        this.advance(STEP);
      }
    } else {
      this.slowAcc = 0;
      this.advance(dt);
    }
    const sim = this.sim;
    const r = sim.rider;
    this.deps.sfx.ride({
      speed: r.speed,
      hv: r.hv,
      hx: r.hx,
      tuck: sim.tuck,
      air: r.air,
      active: this.phase === 'playing' && this.feedback.hitStop <= 0 && this.lessonScale > 0.5,
      brake: r.brake,
    });
  }

  /** The lesson's clocks: it goes once the run is back to full speed, and the next waits `LESSON_GAP` after. */
  private stepLesson(dt: number): void {
    this.lessonT += dt;
    if (this.lessonOutT === null) return;
    this.lessonOutT += dt;
    if (this.lessonOutT >= LESSON_EASE_OUT) {
      this.lesson = null;
      this.lessonOutT = null;
      this.lessonEnd = this.sim.runTime;
    }
  }

  /** One step of the world: the sim, the effects and the camera. */
  private advance(dt: number): void {
    this.settleBlend();
    if (this.feedback.hitStop > 0) {
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

  /** This run as a dare to send, for the share card and tests. */
  cardData(): Dare | null {
    return (
      this.result &&
      toCard(this.result, this.sim.killer?.kind ?? null, this.progress.gear.kit === 'skis')
    );
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
      this.lesson = null;
      this.lessonOutT = null;
      return;
    }
    const stats = this.progress.stats;
    if (!this.lesson && tutorialOn(stats)) {
      const lesson = nextLesson(sim, stats.lessons, this.touch, lessonReadyAt(this.lessonEnd));
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
    const bestBefore = this.overallBest;
    const res = recordRun(this.deps.store, summary, this.day());
    this.result = res;
    this.reportFinish(res, bestBefore);
    this.deps.announce?.(
      `${this.crashWord}. ${res.dist} metres, score ${res.score}${res.newBest ? ', a new best' : ''}.`,
    );
  }

  /** Analytics for a run that reached game over: its end, a dare's result, what it unlocked, the tutorial ending. */
  private reportFinish(res: RunResult, bestBefore: number): void {
    this.runLive = false;
    this.track(
      runEndedEvent({
        end: 'crash',
        cause: runEnd(res.summary.cause, this.sim.killer?.kind ?? null),
        metres: res.dist,
        best: bestBand(res.score, bestBefore, res.newBest),
        setup: this.runSetup(),
        lifeRun: this.lifeRun,
      }),
    );
    if (this.dare)
      this.track(dareResultEvent(dareOutcome(res.score, this.dare.score), this.dareTries));
    for (const a of res.achievements) this.track(unlockEarnedEvent('achievement', a.id));
    for (const g of res.gear) this.track(unlockEarnedEvent('gear', g.id));
    this.checkTutorialEnd();
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

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
