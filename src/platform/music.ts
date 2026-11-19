/**
 * The soundtrack, in two parts: the lobby (one fixed track, looped, for the title, menus and game over) and the run
 * (the other tracks, shuffled, while riding). `Playlist`, `Chain` and `Music` hold the rules and know nothing of the
 * browser: they talk to an `Audio` and a `Clock`, which tests replace with fakes. `WebAudio` is the browser's side,
 * four <audio> elements ("voices") through WebAudio gains into the game's master, so MUTE silences it with everything
 * else. Nothing is created or fetched until the first gesture. What it does for each scene is `plan`
 * (`core/soundtrack.ts`), a pure function.
 */

import {
  MUSIC_CROSS_S,
  MUSIC_FADE_S,
  MUSIC_LEVEL,
  MUSIC_MAX_FAILS,
  MUSIC_PAUSE_LEVEL,
  MUSIC_PREFETCH_S,
} from '../core/config';
import { Fade, plan, type Mix, type Part, type Scene } from '../core/soundtrack';

/** One <audio> element and its own gain. Every method may be called in any state and must never throw. */
export interface Voice {
  /** Sets the file, from its start, without playing it. */
  load(file: string): void;
  /** Starts or resumes. Rejects with the error's `name`, 'NotAllowedError' when the browser wants a gesture first. */
  play(): Promise<void>;
  pause(): void;
  /** Not playing: nothing loaded, stopped, or paused by the system (an iOS interruption). */
  paused(): boolean;
  /** Empties it: no file, no position. */
  release(): void;
  fadeTo(level: number, seconds: number): void;
  /** Called with the seconds left, about four times a second while it plays. */
  onRemaining(cb: (seconds: number) => void): void;
  onEnded(cb: () => void): void;
  /** The file cannot be fetched or decoded. */
  onError(cb: () => void): void;
}

/** The level of a whole part (the lobby or the run). */
export interface Fader {
  fadeTo(level: number, seconds: number): void;
}

export interface Audio {
  /** The voice `slot` (0 or 1) of part 0 (lobby) or 1 (run). */
  voice(part: 0 | 1, slot: 0 | 1): Voice;
  fader(part: 0 | 1): Fader;
  /** Asks the browser for `file` ahead of its turn. */
  prefetch(file: string): void;
  /** Unlocks the voices that are idle (iOS lets an element play only after a gesture has started it). */
  prime(): void;
}

export interface Clock {
  /** Seconds, on any steady clock. */
  now(): number;
  /** Calls `fn` after `seconds`; the result cancels it. */
  later(seconds: number, fn: () => void): () => void;
}

/** A shuffled, endless order of `count` things: every one once per round, and never the same one twice in a row. */
export class Playlist {
  private order: number[] = [];
  private last = -1;

  constructor(
    private readonly count: number,
    private readonly rng: () => number,
  ) {}

  next(): number {
    if (this.count <= 0) return -1;
    if (this.order.length === 0) {
      const order = Array.from({ length: this.count }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const a = order[i] ?? 0;
        order[i] = order[j] ?? 0;
        order[j] = a;
      }
      // A new round must not start with the track that ended the last one.
      if (order.length > 1 && order[0] === this.last) {
        const a = order[0] ?? 0;
        order[0] = order[order.length - 1] ?? 0;
        order[order.length - 1] = a;
      }
      this.order = order;
    }
    const n = this.order.shift() ?? 0;
    this.last = n;
    return n;
  }
}

/**
 * One part: tracks played one after another on two voices, each handing over to the next with an equal-power
 * crossfade of `MUSIC_CROSS_S` (the next starts while the last seconds of this one play), the lobby's one track into
 * itself. The part's own level is its `Fader`'s, and belongs to `Music`.
 */
class Chain {
  /** The voice playing now. */
  private cur: 0 | 1 = 0;
  private crossing = false;
  private nextFile: string | null = null;
  /** A track is loaded (playing or paused) and can be resumed. */
  private has = false;
  private failures = 0;
  /** True from a start to a stop: the part is meant to be heard (a pause because the page is hidden keeps it). */
  active = false;

  constructor(
    private readonly voices: readonly [Voice, Voice],
    private readonly audio: Audio,
    private readonly clock: Clock,
    private readonly pick: () => string,
  ) {
    voices.forEach((v, slot) => {
      v.onRemaining((s) => this.remaining(slot, s));
      v.onEnded(() => this.ended(slot));
      v.onError(() => this.failed(slot));
    });
  }

  /** True once it has given up: `MUSIC_MAX_FAILS` tracks in a row would not play. */
  get gaveUp(): boolean {
    return this.failures >= MUSIC_MAX_FAILS;
  }

  private voice(slot: number): Voice {
    return this.voices[slot === 0 ? 0 : 1];
  }

  /** A new track from its start on the current voice. */
  start(): void {
    this.active = true;
    this.has = true;
    this.crossing = false;
    this.nextFile = null;
    const other = this.voice(1 - this.cur);
    other.pause();
    other.release();
    this.begin(this.cur, this.pick(), 1);
  }

  /** Plays what is loaded from where it was, or starts if nothing is. */
  resume(): void {
    this.active = true;
    if (this.gaveUp) return;
    if (!this.has) {
      this.start();
      return;
    }
    const other: 0 | 1 = this.cur === 0 ? 1 : 0;
    if (this.voices[this.cur].paused()) this.playVoice(this.cur);
    if (this.crossing && this.voices[other].paused()) this.playVoice(other);
  }

  /** Pauses both voices, keeping their place. */
  halt(): void {
    this.voices[0].pause();
    this.voices[1].pause();
  }

  /** Stops for good (`keep` leaves the track where it is, for the lobby to come back to). */
  stop(keep: boolean): void {
    this.active = false;
    this.halt();
    if (!keep) {
      this.voices[0].release();
      this.voices[1].release();
      this.has = false;
      this.crossing = false;
      this.nextFile = null;
    }
  }

  /** The playing track gives way to a new one over `seconds` (a restart in a run). */
  skip(seconds: number): void {
    this.active = true;
    this.cross(seconds, this.pick());
  }

  private begin(slot: 0 | 1, file: string, level: number): void {
    const v = this.voices[slot];
    v.load(file);
    v.fadeTo(level, 0);
    this.playVoice(slot);
  }

  private playVoice(slot: number): void {
    const v = this.voice(slot);
    v.play().catch((e: unknown) => {
      // Waiting for a gesture is not a failure: the next nudge tries again.
      if (!(e instanceof Error) || e.name !== 'NotAllowedError') this.failed(slot);
    });
  }

  private remaining(slot: number, seconds: number): void {
    if (slot !== this.cur) return;
    this.failures = 0;
    if (this.crossing) return;
    if (seconds <= MUSIC_PREFETCH_S && this.nextFile === null) {
      this.nextFile = this.pick();
      this.audio.prefetch(this.nextFile);
    }
    if (seconds <= MUSIC_CROSS_S) this.cross(seconds, this.nextFile ?? this.pick());
  }

  private ended(slot: number): void {
    // The last second came and went without a crossfade (a skipped time update): go on at once.
    if (slot === this.cur && !this.crossing && this.active)
      this.cross(0, this.nextFile ?? this.pick());
  }

  private failed(slot: number): void {
    if (slot !== this.cur) return;
    this.failures++;
    if (this.gaveUp) {
      this.halt();
      return;
    }
    if (this.active) this.cross(0, this.pick());
  }

  /** Hands over to `file` on the other voice over `seconds`. */
  private cross(seconds: number, file: string): void {
    const old = this.voice(this.cur);
    const next: 0 | 1 = this.cur === 0 ? 1 : 0;
    this.cur = next;
    this.nextFile = null;
    this.crossing = true;
    const v = this.voices[next];
    v.load(file);
    v.fadeTo(0, 0);
    this.playVoice(next);
    v.fadeTo(1, seconds);
    old.fadeTo(0, seconds);
    this.clock.later(seconds + 0.1, () => {
      if (this.cur === next) this.crossing = false;
      if (this.voice(this.cur) !== old) {
        old.pause();
        old.release();
      }
    });
  }
}

export class Music {
  private readonly lobby: Chain;
  private readonly run: Chain;
  private readonly chains: readonly [Chain, Chain];
  private readonly targets: [number, number] = [0, 0];
  private readonly timers: Array<(() => void) | null> = [null, null];
  private wanted = false;
  private scene: Scene | null = null;
  private runId = -1;
  private runEndedAt = -Infinity;

  /** `lobbyFile` is the lobby's one track, `runFiles` the tracks the run shuffles. */
  constructor(
    private readonly audio: Audio,
    private readonly clock: Clock,
    lobbyFile: string,
    runFiles: readonly string[],
    rng: () => number,
  ) {
    const playlist = new Playlist(runFiles.length, rng);
    this.lobby = new Chain([audio.voice(0, 0), audio.voice(0, 1)], audio, clock, () => lobbyFile);
    this.run = new Chain(
      [audio.voice(1, 0), audio.voice(1, 1)],
      audio,
      clock,
      () => runFiles[playlist.next()] ?? lobbyFile,
    );
    this.chains = [this.lobby, this.run];
  }

  /** Whether the music should be playing: on, not muted, page visible and the audio context running. */
  setWanted(wanted: boolean): void {
    if (wanted === this.wanted) {
      // A play the browser refused (no gesture yet) or an interrupted context is tried again on every nudge.
      if (wanted) this.chains.forEach((c) => c.active && !c.gaveUp && c.resume());
      return;
    }
    this.wanted = wanted;
    if (!wanted) {
      this.cancelTimers();
      this.chains.forEach((c) => c.halt());
      return;
    }
    this.resumeScene();
  }

  /** A gesture: unlock the idle voices. */
  gesture(): void {
    this.audio.prime();
  }

  /** The scene of the game now, and which run it is (a new one starts a fresh run track). Cheap to call every frame. */
  setScene(scene: Scene, runId: number): void {
    if (scene === this.scene && runId === this.runId) return;
    const prev = this.scene;
    const newRun = runId !== this.runId;
    const wasRun = prev === 'run' || prev === 'pause';
    if (wasRun && scene !== 'run' && scene !== 'pause') this.runEndedAt = this.clock.now();
    this.scene = scene;
    this.runId = runId;
    if (!this.wanted) return;
    const mix = plan(prev, scene, newRun, this.clock.now() - this.runEndedAt);
    if (mix) this.apply(mix);
  }

  private cancelTimers(): void {
    for (let i = 0; i < 2; i++) {
      this.timers[i]?.();
      this.timers[i] = null;
    }
  }

  private apply(mix: Mix): void {
    // The run part first: its fade out starts before the lobby's fade in.
    if (mix.fresh) this.startRun(mix.run);
    else this.move(1, mix.run);
    this.move(0, mix.lobby);
  }

  private startRun(part: Part): void {
    this.timers[1]?.();
    this.timers[1] = null;
    this.targets[1] = part.level;
    const fader = this.audio.fader(1);
    if (this.run.active && !this.run.gaveUp) {
      // Already audible (a restart): the playing track gives way to a fresh one.
      fader.fadeTo(part.level, part.fade);
      this.run.skip(part.fade);
      return;
    }
    this.run.stop(false);
    fader.fadeTo(0, 0);
    this.run.start();
    fader.fadeTo(part.level, part.fade);
  }

  /** Takes part `i` to `part`: up (starting it if it was stopped) or down (and stopped when it is silent). */
  private move(i: 0 | 1, part: Part): void {
    this.timers[i]?.();
    this.timers[i] = null;
    if (part.delay > 0) {
      this.timers[i] = this.clock.later(part.delay, () => this.move(i, { ...part, delay: 0 }));
      return;
    }
    const chain = this.chains[i];
    const fader = this.audio.fader(i);
    this.targets[i] = part.level;
    if (part.level > 0) {
      if (!chain.active) {
        fader.fadeTo(0, 0);
        chain.resume();
      }
      fader.fadeTo(part.level, part.fade);
    } else if (chain.active) {
      fader.fadeTo(0, part.fade);
      // The lobby keeps its place for when it comes back; a run track is not kept.
      this.timers[i] = this.clock.later(part.fade + 0.05, () => {
        this.timers[i] = null;
        chain.stop(i === 0);
      });
    }
  }

  /** The page is back (or music switched on): carry on with the scene as it is, fading in. */
  private resumeScene(): void {
    const scene = this.scene;
    if (scene === 'lobby') {
      this.targets[0] = 1;
      this.audio.fader(0).fadeTo(0, 0);
      this.lobby.resume();
      this.audio.fader(0).fadeTo(1, MUSIC_FADE_S);
    } else if (scene === 'run' || scene === 'pause') {
      const level = scene === 'run' ? 1 : MUSIC_PAUSE_LEVEL;
      this.targets[1] = level;
      const fader = this.audio.fader(1);
      fader.fadeTo(0, 0);
      if (this.run.active) this.run.resume();
      else this.run.start();
      fader.fadeTo(level, MUSIC_FADE_S);
    }
  }
}

/** The browser's clock. */
export const webClock: Clock = {
  now: () => performance.now() / 1000,
  later: (seconds, fn) => {
    const id = setTimeout(fn, seconds * 1000);
    return () => clearTimeout(id);
  },
};

/** 0.1 s of silence, to let an idle element be started from a gesture. */
const SILENT =
  'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** How often gains are moved while a fade runs, in milliseconds. */
const TICK_MS = 25;

/** A gain node moved by `Fade`: the level is stepped every `TICK_MS` and smoothed, so a fade can be retargeted. */
class Knob {
  private readonly fade: Fade;
  constructor(
    private readonly ctx: AudioContext,
    readonly gain: GainNode,
    start: number,
  ) {
    this.fade = new Fade(start);
    gain.gain.value = start;
  }

  fadeTo(level: number, seconds: number): void {
    this.fade.to(level, seconds, this.ctx.currentTime);
    this.step();
  }

  /** Moves the gain to where the fade is now; true while it still has a way to go. */
  step(): boolean {
    const now = this.ctx.currentTime;
    try {
      this.gain.gain.setTargetAtTime(this.fade.at(now), now, 0.01);
    } catch {
      this.gain.gain.value = this.fade.at(now);
    }
    return !this.fade.done(now);
  }
}

class WebVoice implements Voice {
  private readonly el = new Audio();
  private readonly knob: Knob;
  private loaded = false;
  private primed = false;
  private remainingCb: (s: number) => void = () => {};
  private endedCb: () => void = () => {};
  private errorCb: () => void = () => {};

  constructor(
    private readonly owner: WebAudio,
    ctx: AudioContext,
    out: AudioNode,
  ) {
    const el = this.el;
    el.preload = 'auto';
    const gain = ctx.createGain();
    this.knob = new Knob(ctx, gain, 0);
    gain.connect(out);
    try {
      ctx.createMediaElementSource(el).connect(gain);
    } catch {
      // Without the graph the element plays straight to the speakers and MUTE would not reach it: stay silent.
      el.muted = true;
    }
    el.addEventListener('ended', () => this.loaded && this.endedCb());
    el.addEventListener('error', () => this.loaded && this.errorCb());
    el.addEventListener('timeupdate', () => {
      if (this.loaded && Number.isFinite(el.duration))
        this.remainingCb(el.duration - el.currentTime);
    });
  }

  get knobs(): Knob {
    return this.knob;
  }

  load(file: string): void {
    this.loaded = true;
    try {
      this.el.src = this.owner.url(file);
    } catch {
      this.errorCb();
    }
  }
  play(): Promise<void> {
    try {
      this.primed = true;
      return this.el.play();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error('play failed'));
    }
  }
  pause(): void {
    try {
      this.el.pause();
    } catch {
      // Nothing to stop.
    }
  }
  paused(): boolean {
    return !this.loaded || this.el.paused;
  }
  release(): void {
    this.loaded = false;
    try {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    } catch {
      // Already empty.
    }
  }
  fadeTo(level: number, seconds: number): void {
    this.knob.fadeTo(level, seconds);
    this.owner.tick();
  }
  onRemaining(cb: (s: number) => void): void {
    this.remainingCb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: () => void): void {
    this.errorCb = cb;
  }

  /** Starts silence from a gesture so that a later play, from anywhere, is allowed. Idle voices only. */
  prime(): void {
    if (this.primed || this.loaded) return;
    const el = this.el;
    try {
      el.muted = true;
      el.src = SILENT;
      void el
        .play()
        .then(() => {
          this.primed = true;
          if (!this.loaded) el.pause();
        })
        .catch(() => {})
        .finally(() => {
          if (!this.loaded) {
            el.muted = false;
            el.removeAttribute('src');
          }
        });
    } catch {
      // A later gesture tries again.
    }
  }
}

/**
 * The browser's side: four elements (two per part) because iOS only lets an element play after a gesture has started
 * it, and one made later, when a track is due, would be refused. They are made at once, unlocked on the first gesture
 * and reused by changing their `src`. Each goes through its own gain, then its part's, then `MUSIC_LEVEL`, then the
 * master.
 */
export class WebAudio implements Audio {
  private readonly voices: WebVoice[] = [];
  private readonly faders: Knob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    ctx: AudioContext,
    master: AudioNode,
    private readonly base: (file: string) => string,
  ) {
    const bus = ctx.createGain();
    bus.gain.value = MUSIC_LEVEL;
    bus.connect(master);
    for (let part = 0; part < 2; part++) {
      const gain = ctx.createGain();
      gain.connect(bus);
      this.faders.push(new Knob(ctx, gain, 0));
      for (let slot = 0; slot < 2; slot++) this.voices.push(new WebVoice(this, ctx, gain));
    }
  }

  url(file: string): string {
    return this.base(file);
  }

  voice(part: 0 | 1, slot: 0 | 1): Voice {
    const v = this.voices[part * 2 + slot];
    if (!v) throw new Error('no such voice');
    return v;
  }

  fader(part: 0 | 1): Fader {
    const k = this.faders[part];
    if (!k) throw new Error('no such fader');
    return {
      fadeTo: (level, seconds) => {
        k.fadeTo(level, seconds);
        this.tick();
      },
    };
  }

  prefetch(file: string): void {
    // Warm the HTTP cache so the track starts at once when its turn comes. Best effort: a failure here is not one.
    try {
      fetch(this.base(file), { cache: 'force-cache' })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    } catch {
      // No fetch: it will just load when played.
    }
  }

  prime(): void {
    this.voices.forEach((v) => v.prime());
  }

  /** Keeps the gains moving while any fade is under way. */
  tick(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      let moving = false;
      for (const k of this.faders) moving = k.step() || moving;
      for (const v of this.voices) moving = v.knobs.step() || moving;
      if (!moving && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, TICK_MS);
  }
}
