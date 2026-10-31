import type { Sfx } from './audio';
import { GHOST_ENABLED, RIDER_SCREEN_Y, RIDER_SCREEN_Y_FAST, START_Y } from './config';
import { Particles } from './effects';
import type { Action, Input } from './input';
import { poseOf } from './rider';
import { BOARD_LEN } from './render/riderSprite';
import { menuButtons, type ButtonId } from './menu';
import {
  ACHIEVEMENTS,
  applyRun,
  BOARDS,
  boardIndex,
  cycleGear,
  RIDERS,
  riderIndex,
  type Achievement,
  type GearDef,
  type RunSummary,
} from './progress';
import { ReplayPlayer, ReplayRecorder, replayOptions } from './replay';
import { flipName } from './score';
import { dailySeed, isDailySeed, normalizeSeed, randomSeedString } from './rng';
import { CRASH_TIME, Sim, type SimEvent, type SimInput } from './sim';
import type { ResultCardData } from './share';
import type { Store } from './storage';

export type Phase = 'title' | 'playing' | 'paused' | 'crashed' | 'over';
export type Screen = 'main' | 'scores' | 'gear' | 'goals';

export interface Toast {
  text: string;
  ttl: number;
  max: number;
  /** Yellow for good news, white for plain information. */
  hot: boolean;
}

/** What the game over screen shows about the run that just ended. */
export interface RunResult {
  summary: RunSummary;
  score: number;
  dist: number;
  rank: number | null;
  newSeedBest: boolean;
  newOverallBest: boolean;
  achievements: Achievement[];
  gear: GearDef[];
}

export interface GameDeps {
  store: Store;
  input: Input;
  sfx: Sfx;
  reducedMotion: () => boolean;
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
/** Seconds the panel takes to slide in. */
export const PANEL_SLIDE = 0.35;
/** Seconds the killer obstacle flashes. */
export const KILLER_FLASH = 1.6;

function dayString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The shell around the sim: phases and menus, effects, camera, persistence, audio and the ghost. */
export class Game {
  phase: Phase = 'title';
  screen: Screen = 'main';
  scoreTab: 'seed' | 'daily' = 'seed';
  seed = '';
  sim!: Sim;
  ghost: Sim | null = null;
  result: RunResult | null = null;
  /** Keyboard focus in the current button list, and whether to draw it. */
  focus = 0;
  focusVisible = false;

  readonly particles = new Particles(512);
  toasts: Toast[] = [];
  /** Gate id to seconds left of its "passed" flash. */
  readonly gateFlash = new Map<number, number>();
  camY = 0;
  camOff = RIDER_SCREEN_Y;
  /** Seconds the world has been animating (stops while paused). */
  animT = 0;
  shake = 0;
  /** 0..1 zoom punch that decays quickly. */
  punch = 0;
  /** Seconds the simulation stays frozen after an impact. The render keeps running. */
  hitStop = 0;
  overAt = 0;
  /** Running count of pickups in a row, for the pitch ladder. */
  private streak = 0;
  private lastPickupAt = -10;
  private trickQueued = false;
  /** A flip pressed since the last step (a fast tap or a touch button): 1 back, -1 front. */
  private flipQueued: -1 | 0 | 1 = 0;
  private recorder = new ReplayRecorder();
  private ghostPlayer: ReplayPlayer | null = null;
  private brakeTick = 0;
  /** Seconds the current skid has been held; the plume builds with it. */
  private skid = 0;
  /** 0..1 white-out over the rider's face at the peak of a fast skid. */
  faceShot = 0;
  private readonly simInput: SimInput = { steer: 0, trick: false, brake: false, flip: 0 };
  private sharing = false;

  constructor(
    private readonly deps: GameDeps,
    initialSeed?: string | null,
  ) {
    this.deps.sfx.setMuted(this.settings.muted);
    this.deps.sfx.setMusic(this.settings.music);
    this.newRun(normalizeSeed(initialSeed) ?? randomSeedString());
  }

  get settings(): ReturnType<Store['settings']> {
    return this.deps.store.settings();
  }

  get progress(): ReturnType<Store['progress']> {
    return this.deps.store.progress();
  }

  get store(): Store {
    return this.deps.store;
  }

  get today(): string {
    return dailySeed(this.deps.now?.() ?? new Date());
  }

  get reduced(): boolean {
    return this.deps.reducedMotion();
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

  get daily(): boolean {
    return isDailySeed(this.seed);
  }

  get touch(): boolean {
    return this.deps.input.usingTouch;
  }

  /** Screen y the rider is drawn at, given the current camera. */
  get riderScreenY(): number {
    return this.sim.rider.y - this.camYi;
  }

  /** Reset the world for a seed and wait on the title screen (or go straight in if `play`). */
  newRun(seed: string, play = false): void {
    this.seed = seed;
    this.deps.onSeed?.(seed);
    this.sim = new Sim(seed, { touch: this.touch, manualSpin: this.settings.manualSpin });
    this.recorder = new ReplayRecorder();
    this.setupGhost();
    this.particles.clear();
    this.toasts = [];
    this.gateFlash.clear();
    this.camOff = RIDER_SCREEN_Y;
    this.camY = this.sim.rider.y - this.camOff;
    this.shake = 0;
    this.punch = 0;
    this.skid = 0;
    this.faceShot = 0;
    this.hitStop = 0;
    this.streak = 0;
    this.trickQueued = false;
    this.flipQueued = 0;
    this.result = null;
    this.phase = 'title';
    this.screen = 'main';
    this.resetFocus();
    if (play) this.begin();
  }

  private setupGhost(): void {
    const replay = GHOST_ENABLED ? this.deps.store.ghost(this.seed) : null;
    if (replay) {
      this.ghost = new Sim(this.seed, replayOptions(replay));
      this.ghostPlayer = new ReplayPlayer(replay);
    } else {
      this.ghost = null;
      this.ghostPlayer = null;
    }
  }

  begin(): void {
    if (this.phase !== 'title') return;
    this.phase = 'playing';
    this.sim.begin();
    this.ghost?.begin();
    this.deps.input.releaseAll();
    this.deps.sfx.start();
    this.deps.announce?.(`Run started. Seed ${this.seed}.`);
  }

  update(dt: number): void {
    this.handleInput();
    if (this.phase !== 'paused') this.animT += dt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.stepEffects(dt, false);
    } else {
      switch (this.phase) {
        case 'playing':
          this.stepPlaying(dt);
          break;
        case 'crashed':
          this.stepCrashed(dt);
          break;
        default:
          break;
      }
      if (this.phase !== 'paused') this.stepEffects(dt, true);
    }
    this.updateCamera(dt);
    const sim = this.sim;
    const r = sim.rider;
    this.deps.sfx.ride({
      speed: r.speed,
      hv: r.hv,
      hx: r.hx,
      tuck: sim.tuck,
      danger: sim.danger,
      air: r.air,
      active: this.phase === 'playing' && this.hitStop <= 0,
      ice: sim.surface.ice,
      drift: sim.surface.drift,
      brake: r.brake,
    });
  }

  /** Pause when the page loses focus so a run never plays on while hidden. */
  autoPause(force = false): void {
    if (this.phase === 'playing' && (force || this.settings.autoPause)) this.togglePause();
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.deps.input.releaseAll();
      this.resetFocus();
      this.deps.announce?.('Paused.');
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.deps.announce?.('Resumed.');
    }
  }

  /** The seed's replay of this run, for the share card and tests. */
  cardData(): ResultCardData | null {
    const res = this.result;
    if (!res) return null;
    return {
      seed: this.seed,
      daily: this.daily,
      score: res.score,
      dist: res.dist,
      stars: res.summary.stars,
      nearMisses: res.summary.nearMisses,
      tricks: res.summary.tricks,
      gates: res.summary.gates,
      cause: res.summary.cause,
      newBest: res.newSeedBest,
    };
  }

  private resetFocus(): void {
    this.focus = 0;
    this.focusVisible = false;
  }

  setMuted(muted: boolean): void {
    this.deps.store.saveSettings({ muted });
    this.deps.sfx.setMuted(muted);
    if (!muted) this.deps.sfx.wake();
    this.deps.announce?.(muted ? 'Sound off.' : 'Sound on.');
  }

  private toggleSetting(key: 'music' | 'bigHud' | 'autoPause' | 'manualSpin'): void {
    const next = !this.settings[key];
    this.deps.store.saveSettings({ [key]: next });
    if (key === 'music') this.deps.sfx.setMusic(next);
    // The spin mode is part of the run's rules: it can change only before the run starts.
    if (key === 'manualSpin' && this.phase === 'title') this.sim.opts.manualSpin = next;
    this.deps.announce?.(`${key} ${next ? 'on' : 'off'}.`);
  }

  private handleInput(): void {
    const items = this.deps.input.drain();
    for (const item of items) {
      if (item.kind === 'tap') this.handleTap(item.x, item.y);
      else this.handleAction(item.action);
    }
  }

  private handleTap(x: number, y: number): void {
    this.focusVisible = false;
    const buttons = menuButtons(this);
    for (let i = 0; i < buttons.length; i++) {
      const bt = buttons[i];
      if (bt && x >= bt.x && x < bt.x + bt.w && y >= bt.y && y < bt.y + bt.h) {
        this.focus = i;
        this.press(bt.id);
        return;
      }
    }
    // A tap on empty space is the default action: start, resume, or go again.
    switch (this.phase) {
      case 'title':
        if (this.screen === 'main') this.begin();
        else this.screen = 'main';
        break;
      case 'paused':
        this.togglePause();
        break;
      case 'over':
        if (this.animT - this.overAt > RESTART_GUARD) this.newRun(randomSeedString(), true);
        break;
      default:
        break;
    }
  }

  private handleAction(action: Action): void {
    const playing = this.phase === 'playing';
    switch (action) {
      case 'mute':
        this.setMuted(!this.deps.sfx.muted);
        break;
      case 'music':
        this.toggleSetting('music');
        break;
      case 'hud':
        this.toggleSetting('bigHud');
        break;
      case 'manual':
        this.toggleSetting('manualSpin');
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'trick':
        if (playing) this.trickQueued = true;
        break;
      case 'up':
        if (playing) this.flipQueued = -1;
        else this.moveFocus(-1);
        break;
      case 'down':
        if (playing) this.flipQueued = 1;
        else this.moveFocus(1);
        break;
      case 'left':
      case 'right':
        if (this.phase === 'title' && this.screen === 'gear') {
          const dir = action === 'left' ? -1 : 1;
          this.cycleGear(this.focus >= 3 ? 'rider' : 'board', dir);
        }
        break;
      case 'start': {
        if (playing) {
          this.trickQueued = true;
          break;
        }
        this.focusVisible = this.focusVisible && this.phase !== 'title';
        const bt = menuButtons(this)[this.focus] ?? menuButtons(this)[0];
        if (bt) this.press(bt.id);
        else if (this.phase === 'over' && this.animT - this.overAt > RESTART_GUARD) {
          this.newRun(randomSeedString(), true);
        }
        break;
      }
      case 'back':
        if (playing) this.togglePause();
        else if (this.phase === 'paused') this.togglePause();
        else if (this.phase === 'title' && this.screen !== 'main') this.screen = 'main';
        break;
      case 'retry':
        if (this.phase === 'over' || this.phase === 'paused' || this.phase === 'crashed') {
          this.newRun(this.seed, true);
        }
        break;
      case 'share':
        if (this.phase === 'over') this.press('share');
        break;
    }
  }

  private moveFocus(dir: 1 | -1): void {
    const n = menuButtons(this).length;
    if (n === 0) return;
    this.focusVisible = true;
    this.focus = (this.focus + dir + n) % n;
  }

  private cycleGear(which: 'board' | 'rider', dir: 1 | -1): void {
    const p = this.progress;
    const list = which === 'board' ? BOARDS : RIDERS;
    p.gear[which] = cycleGear(list, p.gear[which], p, dir);
    this.deps.store.saveProgress();
  }

  /** Run the action behind a button. */
  press(id: ButtonId): void {
    const overReady = this.animT - this.overAt > RESTART_GUARD;
    switch (id) {
      case 'play':
        this.begin();
        break;
      case 'daily':
        this.newRun(this.today, true);
        break;
      case 'newseed':
        this.newRun(randomSeedString());
        break;
      case 'scores':
        this.scoreTab = 'seed';
        this.openScreen('scores');
        break;
      case 'gear':
        this.openScreen('gear');
        break;
      case 'goals':
        this.openScreen('goals');
        break;
      case 'back':
        this.openScreen('main');
        break;
      case 'tabSeed':
        this.scoreTab = 'seed';
        break;
      case 'tabDaily':
        this.scoreTab = 'daily';
        break;
      case 'sound':
        this.setMuted(!this.deps.sfx.muted);
        break;
      case 'music':
        this.toggleSetting('music');
        break;
      case 'hud':
        this.toggleSetting('bigHud');
        break;
      case 'autopause':
        this.toggleSetting('autoPause');
        break;
      case 'manual':
        this.toggleSetting('manualSpin');
        break;
      case 'boardPrev':
        this.cycleGear('board', -1);
        break;
      case 'boardNext':
        this.cycleGear('board', 1);
        break;
      case 'riderPrev':
        this.cycleGear('rider', -1);
        break;
      case 'riderNext':
        this.cycleGear('rider', 1);
        break;
      case 'resume':
        this.togglePause();
        break;
      case 'restart':
        this.newRun(this.seed, true);
        break;
      case 'quit':
      case 'menu':
        this.newRun(this.seed);
        break;
      case 'again':
        if (overReady) this.newRun(randomSeedString(), true);
        break;
      case 'retry':
        if (overReady) this.newRun(this.seed, true);
        break;
      case 'share':
        void this.share();
        break;
    }
  }

  private openScreen(screen: Screen): void {
    this.screen = screen;
    this.resetFocus();
  }

  /** Render and share the result card; shows the outcome as a toast. */
  async share(): Promise<void> {
    const card = this.cardData();
    if (!card || !this.deps.share || this.sharing) return;
    this.sharing = true;
    try {
      this.showToast(await this.deps.share(card), 2.2, true);
    } catch {
      this.showToast('SHARE FAILED', 2, false);
    } finally {
      this.sharing = false;
    }
  }

  private stepPlaying(dt: number): void {
    void dt;
    const sim = this.sim;
    this.simInput.steer = this.deps.input.steer();
    this.simInput.brake = this.deps.input.brake();
    this.simInput.trick = this.trickQueued;
    this.trickQueued = false;
    this.simInput.flip = this.flipQueued !== 0 ? this.flipQueued : this.deps.input.flip();
    this.flipQueued = 0;
    this.recorder.record(this.simInput);
    sim.step(this.simInput);
    this.stepGhost();
    for (const e of sim.events) this.onEvent(e);
    this.sprayWhileBraking(sim.rider);
    if (sim.crashed) this.phase = 'crashed';
  }

  /**
   * Plowing sideways skids the board's flat base through the snow. The plume scales with speed and
   * builds the longer the skid is held; at the peak of a fast skid it blows into the rider's face.
   */
  private sprayWhileBraking(r: Sim['rider']): void {
    const dt = 1 / 120;
    const skidding = r.brake >= 0.35 && !r.air && r.speed >= 36;
    this.skid = skidding ? this.skid + dt : Math.max(0, this.skid - 3 * dt);
    // Even a cruising skid should read clearly, so speed only scales it from 55% up.
    const f = 0.55 + 0.45 * Math.min(1, Math.max(0, (r.speed - 36) / 150));
    const build = Math.min(1, 0.4 + this.skid / 0.5);
    const peak = skidding && this.skid > 0.15;
    // On a phone the picture is big and the skid is held for a long time, so keep it calm: a lighter spray and no face shot.
    const calm = this.reduced || this.touch;
    const want = peak && !calm ? 0.85 : 0;
    this.faceShot += (want - this.faceShot) * Math.min(1, (want > this.faceShot ? 9 : 5) * dt);
    if (!skidding) return;
    this.brakeTick++;
    if (this.brakeTick % 3 !== 0) return;
    const power = f * build;
    const rand = this.deps.rand ?? Math.random;
    // Particles live in world space, so they inherit the rider's downhill speed; otherwise they just fall behind as a trail.
    const n = Math.round((calm ? 1 : 2) + (this.reduced ? 2 : this.touch ? 4 : 8) * power);
    const carry = r.speed;
    // The board is plowed sideways, so the powder is shoved up off its leading (nose) edge, not the tail.
    const pose = poseOf(r, r.x, r.y, 0);
    const nx = r.x + pose.nx * BOARD_LEN;
    const ny = r.y + pose.ny * BOARD_LEN;
    const mx = r.x + pose.nx * BOARD_LEN * 0.5;
    const my = r.y + pose.ny * BOARD_LEN * 0.5;
    this.particles.jet(nx, ny - 1, n, 70 + 80 * power, 22 + 8 * power, 0.75, rand, carry);
    this.particles.jet(mx, my - 1, n >> 1, 60 + 50 * power, 16, 0.6, rand, carry);
    // Powder thrown ahead of the nose falls back down in front of him.
    if (!calm && power > 0.3) {
      this.particles.jet(nx, ny - 3, 2 + Math.round(3 * power), 40, 18, 0.9, rand, carry * 1.25);
    }
  }

  private stepGhost(): void {
    const ghost = this.ghost;
    if (!ghost || !this.ghostPlayer) return;
    if (ghost.finished) {
      // Let the ghost lie where it fell for a moment, then drop it.
      if (ghost.crashT > CRASH_TIME + 3) this.ghost = null;
      else ghost.step(this.simInput);
      return;
    }
    ghost.step(this.ghostPlayer.at(ghost.steps));
  }

  private stepCrashed(dt: number): void {
    void dt;
    this.sim.step(this.simInput);
    this.stepGhost();
    if (this.sim.finished) this.finish();
  }

  private onEvent(e: SimEvent): void {
    const sfx = this.deps.sfx;
    const sim = this.sim;
    const r = sim.rider;
    const reduced = this.reduced;
    switch (e.type) {
      case 'star': {
        this.streak = this.animT - this.lastPickupAt < 1.1 ? this.streak + 1 : 0;
        this.lastPickupAt = this.animT;
        this.burst(e.x, e.y, e.lane ? 8 : 5, 22, 0.35);
        sfx.pickup(this.streak);
        this.addHitStop(0.025);
        if (!reduced) this.punch = Math.max(this.punch, e.lane ? 0.3 : 0.15);
        if (e.lane) this.showToast(`RISK LANE +${e.value}`, 0.9, true);
        break;
      }
      case 'near': {
        this.showToast(e.combo > 1 ? `CLOSE X${e.combo} +${e.pts}` : `CLOSE! +${e.pts}`, 1, true);
        sfx.nearMiss(e.combo);
        this.buzz(12);
        if (!reduced) {
          this.punch = Math.max(this.punch, 0.35 + 0.12 * e.combo);
          if (e.combo >= 3) this.shake = Math.max(this.shake, 0.18);
        }
        break;
      }
      case 'gate': {
        if (e.ok) {
          this.showToast(`CHECKPOINT +${e.pts}`, 1.4, true);
          sfx.gate();
          const g = sim.gates.find((q) => q.passed && q.success && q.x === e.x);
          if (g) this.gateFlash.set(g.id, 0.7);
          if (!reduced) this.punch = Math.max(this.punch, 0.3);
        } else {
          this.showToast('MISSED THE GATE', 1, false);
        }
        break;
      }
      case 'bush':
        this.burst(e.x, e.y, 8, 40, 0.5);
        sfx.bush();
        break;
      case 'launch':
        sfx.launch();
        this.burst(r.x, r.y + 8, e.cliff ? 14 : 6, e.cliff ? 60 : 36, e.cliff ? 0.7 : 0.4);
        if (e.cliff) this.showToast('DROP!', 1, true);
        break;
      case 'spin':
        this.showToast(`${e.deg}!`, 0.9, true);
        sfx.trick(e.deg / 180);
        break;
      case 'flip':
        this.showToast(`${flipName(e.deg / 360)}!`, 0.9, true);
        sfx.trick(1 + 2 * Math.abs(e.deg / 360));
        break;
      case 'land':
        if (e.quality === 'clean') {
          const name =
            e.flips !== 0
              ? `${e.spin > 0 ? `${e.spin} ` : ''}${flipName(e.flips)}`
              : e.switch
                ? 'SWITCH LANDING'
                : 'CLEAN LANDING';
          if (e.flips !== 0 && e.spin > 0) sfx.trick(6);
          this.showToast(e.pts > 0 ? `${name} +${e.pts}` : name, 1.1, true);
          sfx.land(true);
          this.burst(r.x, r.y + 8, 10, 46, 0.5);
          this.buzz(18);
        } else {
          this.showToast('SLOPPY LANDING', 1.1, false);
          sfx.land(false);
          this.burst(r.x, r.y + 8, 10, 46, 0.5);
        }
        if (!reduced) this.punch = Math.max(this.punch, 0.4);
        break;
      case 'crash':
        this.onCrash(e.cause);
        break;
    }
  }

  private buzz(ms: number): void {
    if (this.settings.haptics) this.deps.haptic?.(ms);
  }

  private onCrash(cause: 'obstacle' | 'bail' | 'avalanche'): void {
    const sim = this.sim;
    this.burst(sim.rider.x, sim.rider.y + 8, 26, 70, 1.1);
    this.addHitStop(this.reduced ? 0.06 : 0.14);
    if (!this.reduced) {
      this.shake = 0.45;
      this.punch = 1;
    }
    this.deps.sfx.crash(cause === 'avalanche');
    this.buzz(60);
    this.toasts = [];
  }

  private addHitStop(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  private finish(): void {
    const sim = this.sim;
    const store = this.deps.store;
    this.phase = 'over';
    this.overAt = this.animT;
    this.resetFocus();
    const score = sim.scoreValue;
    const dist = sim.distM;
    const sc = sim.score;
    const summary: RunSummary = {
      seed: this.seed,
      daily: this.daily,
      dist,
      score,
      stars: sc.stars,
      laneStars: sc.laneStars,
      nearMisses: sc.nearMisses,
      gates: sc.gates,
      tricks: sc.tricks,
      landings: sc.landings,
      maxCombo: sc.maxCombo,
      sendItTime: sim.sendItTime,
      topSpeed: sim.topSpeedSeen,
      minGap: sim.avalanche.minGap,
      time: sim.runTime,
      cause: sim.crashCause,
    };
    const day = dayString(this.deps.now?.() ?? new Date());
    const rec = store.recordRun(this.seed, { score, dist, date: day });
    const out = applyRun(store.progress(), summary, day);
    store.saveProgress();
    if (GHOST_ENABLED && rec.newSeedBest) {
      store.saveGhost(
        this.seed,
        this.recorder.finish(
          this.seed,
          sim.opts.touch === true,
          score,
          dist,
          sim.opts.manualSpin === true,
        ),
      );
    }
    this.result = {
      summary,
      score,
      dist,
      rank: rec.rank,
      newSeedBest: rec.newSeedBest,
      newOverallBest: rec.newOverallBest,
      achievements: out.newAchievements,
      gear: out.newGear,
    };
    this.deps.announce?.(
      `${this.crashWord()}. ${dist} metres, score ${score}${rec.newSeedBest ? ', a new best for this seed' : ''}.`,
    );
  }

  /** Short headline for the game over screen. */
  crashWord(): string {
    switch (this.sim.crashCause) {
      case 'avalanche':
        return 'BURIED';
      case 'bail':
        return 'BAILED';
      default:
        return 'WIPEOUT';
    }
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

  private burst(x: number, y: number, n: number, speed: number, life: number): void {
    if (this.reduced) return;
    this.particles.burst(x, y, n, speed, life, this.deps.rand ?? Math.random);
  }

  showToast(text: string, ttl: number, hot: boolean): void {
    this.toasts = [{ text, ttl, max: ttl, hot }];
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

  private stepEffects(dt: number, simRunning: boolean): void {
    this.shake = Math.max(0, this.shake - dt);
    this.punch *= Math.exp(-9 * dt);
    if (this.punch < 0.01) this.punch = 0;
    if (simRunning) this.particles.step(dt);
    for (const t of this.toasts) t.ttl -= dt;
    if (this.toasts.length > 0 && this.toasts[0].ttl <= 0) this.toasts = [];
    for (const [id, t] of this.gateFlash) {
      if (t - dt <= 0) this.gateFlash.delete(id);
      else this.gateFlash.set(id, t - dt);
    }
  }
}
