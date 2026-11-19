/**
 * The soundtrack: the tracks of `MUSIC_TRACKS` played one after another in a shuffled order. `Playlist` and `Music`
 * hold the rules and know nothing of the browser (they talk to a `TrackSource`, which tests replace with a fake);
 * `WebTracks` is the browser's source, an <audio> element per track routed through the game's WebAudio master gain,
 * so MUTE silences it with everything else. Nothing is fetched until the first gesture: the owner of this object
 * (`Sfx`) only creates it once the audio context exists.
 */

import { MUSIC_FADE_S, MUSIC_LEVEL, MUSIC_MAX_FAILS, MUSIC_PREFETCH_S } from '../core/config';

/** One track on its way to the speakers. Every method may be called in any state and must never throw. */
export interface Track {
  /** Starts or resumes. Rejects with the error's `name`, 'NotAllowedError' when the browser wants a gesture first. */
  play(): Promise<void>;
  pause(): void;
  /** Not playing: not started, stopped, or paused by the system (an iOS interruption). */
  paused(): boolean;
  /** Moves this track's own level to `level` (0 to 1) over `seconds`. */
  fadeTo(level: number, seconds: number): void;
  /** Called with the seconds left, about four times a second while it plays. */
  onRemaining(cb: (seconds: number) => void): void;
  onEnded(cb: () => void): void;
  /** The file cannot be fetched or decoded. */
  onError(cb: () => void): void;
  dispose(): void;
}

export interface TrackSource {
  /** `prefetch` asks for the whole file now; without it the track only loads what it needs to start. */
  open(file: string, prefetch: boolean): Track;
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

interface Slot {
  index: number;
  track: Track;
}

export class Music {
  private readonly playlist: Playlist;
  private current: Slot | null = null;
  private upcoming: Slot | null = null;
  private wanted = false;
  private failures = 0;
  /** Index of the track now playing, or -1. */
  playing = -1;

  constructor(
    private readonly files: readonly string[],
    private readonly source: TrackSource,
    rng: () => number,
  ) {
    this.playlist = new Playlist(files.length, rng);
  }

  /** Whether the music should be playing: on, not muted, page visible and the audio context running. */
  setWanted(wanted: boolean): void {
    if (wanted === this.wanted) {
      // A play the browser refused (no gesture yet) or an interrupted context is tried again on every nudge.
      if (wanted) this.resume();
      return;
    }
    this.wanted = wanted;
    if (wanted) this.resume();
    else this.halt();
  }

  /** True once it has given up, after `MUSIC_MAX_FAILS` tracks in a row that would not play. */
  get gaveUp(): boolean {
    return this.failures >= MUSIC_MAX_FAILS;
  }

  private resume(): void {
    if (this.gaveUp) return;
    if (!this.current) {
      this.begin(this.upcoming ?? this.open(false));
      this.upcoming = null;
      return;
    }
    // Already playing: nothing to do, so a nudge never restarts the fade in.
    if (this.current.track.paused()) this.start(this.current);
  }

  private halt(): void {
    this.current?.track.pause();
  }

  private open(prefetch: boolean): Slot {
    const index = this.playlist.next();
    const track = this.source.open(this.files[index] ?? '', prefetch);
    return { index, track };
  }

  private begin(slot: Slot): void {
    this.current = slot;
    this.playing = slot.index;
    slot.track.onEnded(() => this.advance(slot));
    slot.track.onError(() => this.fail(slot));
    slot.track.onRemaining((s) => {
      if (this.current === slot && s <= MUSIC_PREFETCH_S && !this.upcoming && !this.gaveUp) {
        this.upcoming = this.open(true);
      }
    });
    this.start(slot);
  }

  private start(slot: Slot): void {
    slot.track.fadeTo(0, 0);
    slot.track.fadeTo(1, MUSIC_FADE_S);
    slot.track.play().catch((e: unknown) => {
      // Waiting for a gesture is not a failure: the next nudge tries again.
      if (this.current !== slot) return;
      if (!(e instanceof Error) || e.name !== 'NotAllowedError') this.fail(slot);
    });
  }

  /** The track finished: on to the next one, which has been loading for a while. */
  private advance(slot: Slot): void {
    if (this.current !== slot) return;
    this.failures = 0;
    this.next(slot);
  }

  private fail(slot: Slot): void {
    if (this.current !== slot) return;
    this.failures++;
    this.next(slot);
  }

  private next(old: Slot): void {
    old.track.dispose();
    this.current = null;
    this.playing = -1;
    if (this.gaveUp) {
      this.upcoming?.track.dispose();
      this.upcoming = null;
      return;
    }
    const slot = this.upcoming ?? this.open(false);
    this.upcoming = null;
    if (this.wanted) this.begin(slot);
    else {
      // Not playing now (muted or hidden): keep it ready for when the music comes back.
      this.upcoming = slot;
    }
  }
}

/**
 * The tracks through ONE <audio> element, routed through a gain into `bus` (the music's level on the master). One
 * element on purpose: iOS only lets an element play once a gesture has started it, and a new element made later
 * (when the next track is due) would be refused, where a changed `src` on the unlocked one plays. A `Track` is a
 * handle: it takes the element over when played, and a track that is not the current one ignores the element's events.
 */
export class WebTracks implements TrackSource {
  private readonly el = new Audio();
  private readonly gain: GainNode;
  private active: Handle | null = null;

  constructor(
    private readonly ctx: AudioContext,
    master: AudioNode,
    private readonly url: (file: string) => string,
  ) {
    const bus = ctx.createGain();
    bus.gain.value = MUSIC_LEVEL;
    bus.connect(master);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(bus);
    try {
      ctx.createMediaElementSource(this.el).connect(this.gain);
    } catch {
      // Without the graph the element plays straight to the speakers and MUTE would not reach it: stay silent.
      this.el.muted = true;
    }
    const el = this.el;
    el.preload = 'auto';
    el.addEventListener('ended', () => this.active?.ended());
    el.addEventListener('error', () => this.active?.error());
    el.addEventListener('timeupdate', () => {
      if (Number.isFinite(el.duration)) this.active?.remaining(el.duration - el.currentTime);
    });
  }

  open(file: string, prefetch: boolean): Track {
    const url = this.url(file);
    // Warm the HTTP cache so the track starts at once when its turn comes. Best effort: a failure here is not one.
    if (prefetch) {
      try {
        fetch(url, { cache: 'force-cache' })
          .then((r) => r.arrayBuffer())
          .catch(() => {});
      } catch {
        // No fetch: it will just load when played.
      }
    }
    const h = new Handle(this, url);
    return h;
  }

  /** @internal for `Handle`. */
  claim(h: Handle, url: string): void {
    if (this.active === h) return;
    this.active = h;
    try {
      this.el.src = url;
    } catch {
      h.error();
    }
  }

  /** @internal */
  release(h: Handle): void {
    if (this.active !== h) return;
    this.active = null;
    try {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    } catch {
      // Already stopped.
    }
  }

  /** @internal */
  get element(): HTMLAudioElement {
    return this.el;
  }

  /** @internal */
  fade(level: number, seconds: number): void {
    const g = this.gain.gain;
    try {
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      if (seconds <= 0) g.setValueAtTime(level, now);
      else g.linearRampToValueAtTime(level, now + seconds);
    } catch {
      g.value = level;
    }
  }
}

class Handle implements Track {
  private remainingCb: (s: number) => void = () => {};
  private endedCb: () => void = () => {};
  private errorCb: () => void = () => {};
  private failed = false;

  constructor(
    private readonly owner: WebTracks,
    private readonly url: string,
  ) {}

  play(): Promise<void> {
    try {
      this.owner.claim(this, this.url);
      return this.owner.element.play();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error('play failed'));
    }
  }
  pause(): void {
    try {
      this.owner.element.pause();
    } catch {
      // Nothing to stop.
    }
  }
  paused(): boolean {
    return this.owner.element.paused;
  }
  fadeTo(level: number, seconds: number): void {
    this.owner.fade(level, seconds);
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
  dispose(): void {
    this.owner.release(this);
  }
  remaining(s: number): void {
    this.remainingCb(s);
  }
  ended(): void {
    this.endedCb();
  }
  error(): void {
    if (this.failed) return;
    this.failed = true;
    this.errorCb();
  }
}
