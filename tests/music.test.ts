import { describe, expect, it } from 'vitest';
import {
  MUSIC_CROSS_S,
  MUSIC_FADE_S,
  MUSIC_LOBBY,
  MUSIC_LOBBY_BEAT_S,
  MUSIC_LOBBY_IN_S,
  MUSIC_MAX_FAILS,
  MUSIC_PAUSE_FADE_S,
  MUSIC_PAUSE_LEVEL,
  MUSIC_PREFETCH_S,
  MUSIC_RESTART_S,
  MUSIC_RUN_OUT_S,
  MUSIC_START_S,
  MUSIC_TRACKS,
} from '../src/core/config';
import { Rng } from '../src/core/rng';
import { Fade, plan, type Scene } from '../src/core/soundtrack';
import {
  Music,
  Playlist,
  type Audio,
  type Clock,
  type Fader,
  type Voice,
} from '../src/platform/music';
import { sceneFor } from '../src/state/soundtrack';
import { existsSync, statSync } from 'node:fs';

/** A clock the test moves by hand. Timers run in order as it passes them. */
class FakeClock implements Clock {
  t = 0;
  private queue: Array<{ at: number; fn: () => void; live: boolean }> = [];
  now(): number {
    return this.t;
  }
  later(seconds: number, fn: () => void): () => void {
    const item = { at: this.t + seconds, fn, live: true };
    this.queue.push(item);
    return () => {
      item.live = false;
    };
  }
  advance(seconds: number): void {
    const end = this.t + seconds;
    for (;;) {
      const due = this.queue.filter((q) => q.live && q.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

class FakeVoice implements Voice {
  file: string | null = null;
  playing = false;
  loads: string[] = [];
  plays = 0;
  refuse: string | null = null;
  readonly gain = new Fade(0);
  private remainingCb: (s: number) => void = () => {};
  private endedCb: () => void = () => {};
  private errorCb: () => void = () => {};
  constructor(private readonly clock: FakeClock) {}
  load(file: string): void {
    this.file = file;
    this.playing = false;
    this.loads.push(file);
  }
  play(): Promise<void> {
    this.plays++;
    if (this.refuse) {
      const e = new Error('refused');
      e.name = this.refuse;
      return Promise.reject(e);
    }
    this.playing = true;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
  }
  paused(): boolean {
    return !this.file || !this.playing;
  }
  release(): void {
    this.file = null;
    this.playing = false;
  }
  fadeTo(level: number, seconds: number): void {
    this.gain.to(level, seconds, this.clock.t);
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
  level(): number {
    return this.gain.at(this.clock.t);
  }
  remaining(s: number): void {
    this.remainingCb(s);
  }
  end(): void {
    this.endedCb();
  }
  fail(): void {
    this.errorCb();
  }
}

class FakeAudio implements Audio {
  readonly voices: FakeVoice[];
  readonly faders: Array<Fade>;
  prefetched: string[] = [];
  primed = 0;
  constructor(private readonly clock: FakeClock) {
    this.voices = [0, 1, 2, 3].map(() => new FakeVoice(clock));
    this.faders = [new Fade(0), new Fade(0)];
  }
  voice(part: 0 | 1, slot: 0 | 1): Voice {
    const v = this.voices[part * 2 + slot];
    if (!v) throw new Error('no voice');
    return v;
  }
  fader(part: 0 | 1): Fader {
    const f = this.faders[part];
    if (!f) throw new Error('no fader');
    return { fadeTo: (level, seconds) => f.to(level, seconds, this.clock.t) };
  }
  prefetch(file: string): void {
    this.prefetched.push(file);
  }
  prime(): void {
    this.primed++;
  }
  /** The part's level now. */
  part(i: 0 | 1): number {
    return this.faders[i]?.at(this.clock.t) ?? 0;
  }
  /** What a speaker would get from voices [a, b] of a part: part level times voice level, when playing. */
  heard(i: 0 | 1): number {
    const vs = [this.voices[i * 2], this.voices[i * 2 + 1]];
    return vs.reduce((p, v) => p + (v && v.playing ? (v.level() * this.part(i)) ** 2 : 0), 0);
  }
  lobby(): FakeVoice {
    return this.v(0);
  }
  v(i: number): FakeVoice {
    const v = this.voices[i];
    if (!v) throw new Error('no voice');
    return v;
  }
}

const RUN = MUSIC_TRACKS.map((t) => t.file).filter((f) => f !== MUSIC_LOBBY);

function world(seed = 1): { clock: FakeClock; audio: FakeAudio; music: Music } {
  const clock = new FakeClock();
  const audio = new FakeAudio(clock);
  const rng = new Rng(seed);
  return { clock, audio, music: new Music(audio, clock, MUSIC_LOBBY, RUN, () => rng.next()) };
}

/** A world already in the lobby with the music on. */
function inLobby(): ReturnType<typeof world> {
  const w = world();
  w.music.setWanted(true);
  w.music.setScene('lobby', 0);
  w.clock.advance(MUSIC_FADE_S + 0.1);
  return w;
}

/** A world a few seconds into run number `id` (from the lobby). */
function inRun(id = 1): ReturnType<typeof world> {
  const w = inLobby();
  w.music.setScene('run', id);
  w.clock.advance(MUSIC_START_S + 0.2);
  return w;
}

/** The voice of the run part that plays now: the one going up, not an old one on its way out. */
function runVoice(a: FakeAudio): FakeVoice {
  const v = [a.v(2), a.v(3)].find((x) => x.playing && x.gain.goal === 1);
  if (!v) throw new Error('no run voice playing');
  return v;
}

describe('Fade', () => {
  it('runs from the start level to the target, a quarter sine up and a quarter cosine down', () => {
    const up = new Fade(0);
    up.to(1, 2, 10);
    expect(up.at(10)).toBe(0);
    expect(up.at(11)).toBeCloseTo(Math.sin(Math.PI / 4), 9);
    expect(up.at(12)).toBe(1);
    expect(up.at(50)).toBe(1);
    const down = new Fade(1);
    down.to(0, 2, 10);
    expect(down.at(10)).toBe(1);
    expect(down.at(11)).toBeCloseTo(Math.cos(Math.PI / 4), 9);
    expect(down.at(12)).toBe(0);
  });

  it('keeps equal power when one part rises while another falls', () => {
    const a = new Fade(1);
    const b = new Fade(0);
    a.to(0, 3, 0);
    b.to(1, 3, 0);
    for (let t = 0; t <= 3; t += 0.25) expect(a.at(t) ** 2 + b.at(t) ** 2).toBeCloseTo(1, 9);
  });

  it('jumps with no time, and starts from where it is when moved again part way', () => {
    const f = new Fade(0);
    f.to(1, 0, 0);
    expect(f.at(0)).toBe(1);
    f.to(0, 2, 5);
    const mid = f.at(6);
    f.to(1, 2, 6);
    expect(f.at(6)).toBeCloseTo(mid, 9);
    expect(f.at(8)).toBe(1);
    expect(f.done(7)).toBe(false);
    expect(f.done(8)).toBe(true);
  });
});

describe('plan', () => {
  it('does nothing when the scene does not change in kind', () => {
    expect(plan('lobby', 'lobby', false, 0)).toBeNull();
    expect(plan('run', 'run', false, 0)).toBeNull();
    expect(plan('down', 'down', false, 0)).toBeNull();
    expect(plan('lobby', 'pause', false, 0)).toBeNull();
  });

  it('opens in the lobby with a fade in and no beat', () => {
    const m = plan(null, 'lobby', false, 0);
    expect(m?.lobby).toEqual({ level: 1, fade: MUSIC_FADE_S, delay: 0 });
    expect(m?.run.level).toBe(0);
  });

  it('starts a run by crossfading the lobby out and a fresh run track in', () => {
    const m = plan('lobby', 'run', true, 0);
    expect(m?.fresh).toBe(true);
    expect(m?.run).toEqual({ level: 1, fade: MUSIC_START_S, delay: 0 });
    expect(m?.lobby.level).toBe(0);
    expect(m?.lobby.fade).toBe(MUSIC_START_S);
  });

  it('ends a run quickly and brings the lobby back after a beat', () => {
    expect(plan('run', 'down', false, 0)?.run).toEqual({
      level: 0,
      fade: MUSIC_RUN_OUT_S,
      delay: 0,
    });
    const back = plan('down', 'lobby', false, 0.2);
    expect(back?.lobby.level).toBe(1);
    expect(back?.lobby.fade).toBe(MUSIC_LOBBY_IN_S);
    expect(back?.lobby.delay).toBeCloseTo(MUSIC_LOBBY_BEAT_S - 0.2, 9);
  });

  it('counts the beat from when the run went out, so a long fall waits no longer', () => {
    expect(plan('down', 'lobby', false, 5)?.lobby.delay).toBe(0);
    expect(plan('pause', 'lobby', false, 0)?.lobby.delay).toBe(MUSIC_LOBBY_BEAT_S);
  });

  it('ducks on pause and comes back on resume, but a different run is a fresh track', () => {
    expect(plan('run', 'pause', false, 0)?.run).toEqual({
      level: MUSIC_PAUSE_LEVEL,
      fade: MUSIC_PAUSE_FADE_S,
      delay: 0,
    });
    const resume = plan('pause', 'run', false, 0);
    expect(resume?.fresh).toBe(false);
    expect(resume?.run.level).toBe(1);
    expect(plan('pause', 'run', true, 0)?.fresh).toBe(true);
  });

  it('goes straight to a fresh track on a restart or retry', () => {
    const restart = plan('run', 'run', true, 0);
    expect(restart?.fresh).toBe(true);
    expect(restart?.run.fade).toBe(MUSIC_RESTART_S);
    const retry = plan('down', 'run', true, 0.3);
    expect(retry?.fresh).toBe(true);
    expect(retry?.run.fade).toBe(MUSIC_RESTART_S);
  });
});

describe('sceneFor', () => {
  it('maps every phase', () => {
    const cases: Array<[Parameters<typeof sceneFor>[0], Scene]> = [
      ['title', 'lobby'],
      ['over', 'lobby'],
      ['playing', 'run'],
      ['paused', 'pause'],
      ['crashed', 'down'],
    ];
    for (const [phase, scene] of cases) expect(sceneFor(phase)).toBe(scene);
  });
});

describe('Playlist', () => {
  it('plays every track once per round, in a shuffled order', () => {
    const p = new Playlist(5, () => 0.37);
    const round = Array.from({ length: 5 }, () => p.next());
    expect([...round].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('never repeats a track straight away, across rounds', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7]) {
      const rng = new Rng(seed);
      const p = new Playlist(3, () => rng.next());
      let last = -1;
      for (let i = 0; i < 300; i++) {
        const n = p.next();
        expect(n).not.toBe(last);
        last = n;
      }
    }
  });

  it('is the same order for the same random source, and copes with one track or none', () => {
    const a = new Playlist(6, () => 0.5);
    const b = new Playlist(6, () => 0.5);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
    const one = new Playlist(1, () => 0.5);
    expect([one.next(), one.next()]).toEqual([0, 0]);
    expect(new Playlist(0, () => 0.5).next()).toBe(-1);
  });
});

describe('Music: the lobby', () => {
  it('opens nothing until it is wanted and has a scene, then plays the lobby track with a fade in', () => {
    const w = world();
    w.music.setScene('lobby', 0);
    expect(w.audio.voices.every((v) => v.loads.length === 0)).toBe(true);
    w.music.setWanted(true);
    expect(w.audio.lobby().file).toBe(MUSIC_LOBBY);
    expect(w.audio.lobby().playing).toBe(true);
    w.clock.advance(MUSIC_FADE_S / 2);
    expect(w.audio.part(0)).toBeGreaterThan(0.1);
    expect(w.audio.part(0)).toBeLessThan(0.95);
    w.clock.advance(MUSIC_FADE_S);
    expect(w.audio.part(0)).toBe(1);
  });

  it('stays quiet when the scene is a run before the lobby was ever needed', () => {
    const w = world();
    w.music.setWanted(true);
    w.music.setScene('run', 1);
    expect(w.audio.lobby().loads).toEqual([]);
    expect(runVoice(w.audio).file).not.toBe(MUSIC_LOBBY);
  });

  it('does nothing when going between menus', () => {
    const w = inLobby();
    const loads = w.audio.lobby().loads.length;
    w.music.setScene('lobby', 0);
    w.clock.advance(5);
    expect(w.audio.lobby().loads.length).toBe(loads);
    expect(w.audio.lobby().plays).toBe(1);
  });

  it('loops into itself with a crossfade of the same track near its end', () => {
    const w = inLobby();
    const first = w.audio.lobby();
    first.remaining(MUSIC_PREFETCH_S);
    expect(w.audio.prefetched).toEqual([MUSIC_LOBBY]);
    first.remaining(MUSIC_CROSS_S);
    const second = w.audio.v(1);
    expect(second.file).toBe(MUSIC_LOBBY);
    expect(second.playing).toBe(true);
    for (const t of [0, 1, 2, 3, 4]) {
      w.clock.advance(t === 0 ? 0 : 1);
      if (t > 0 && t <= MUSIC_CROSS_S) {
        const frac = Math.min(1, t / MUSIC_CROSS_S);
        expect(first.level() ** 2 + second.level() ** 2).toBeCloseTo(1, 6);
        expect(second.level()).toBeCloseTo(Math.sin((frac * Math.PI) / 2), 6);
      }
    }
    w.clock.advance(1);
    expect(first.file).toBeNull();
  });
});

describe('Music: a run', () => {
  it('crossfades the lobby out and a run track in, with constant power, never the lobby track', () => {
    const w = inLobby();
    w.music.setScene('run', 1);
    const run = runVoice(w.audio);
    expect(RUN).toContain(run.file);
    expect(run.file).not.toBe(MUSIC_LOBBY);
    for (let t = 0.25; t < MUSIC_START_S; t += 0.25) {
      w.clock.advance(0.25);
      expect(w.audio.part(0) ** 2 + w.audio.part(1) ** 2).toBeCloseTo(1, 6);
    }
    w.clock.advance(0.4);
    expect(w.audio.part(1)).toBe(1);
    expect(w.audio.part(0)).toBe(0);
    // The lobby stopped, but its place is kept.
    expect(w.audio.lobby().playing).toBe(false);
    expect(w.audio.lobby().file).toBe(MUSIC_LOBBY);
  });

  it('never plays the lobby track in the shuffle, over many tracks and runs', () => {
    const w = inRun();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const cur = runVoice(w.audio);
      if (cur.file) seen.add(cur.file);
      cur.remaining(MUSIC_CROSS_S);
      w.clock.advance(MUSIC_CROSS_S + 1);
    }
    expect(seen.has(MUSIC_LOBBY)).toBe(false);
    expect([...seen].sort()).toEqual([...RUN].sort());
  });

  it('crosses from one track to the next with equal power, the next one prefetched first', () => {
    const w = inRun();
    const a = runVoice(w.audio);
    a.remaining(MUSIC_PREFETCH_S + 5);
    expect(w.audio.prefetched).toEqual([]);
    a.remaining(MUSIC_PREFETCH_S);
    const next = w.audio.prefetched[0];
    expect(next).toBeDefined();
    a.remaining(MUSIC_CROSS_S);
    const b = runVoice(w.audio);
    expect(b).not.toBe(a);
    expect(b.file).toBe(next);
    expect(b.file).not.toBe(a.file);
    for (let i = 1; i <= 8; i++) {
      w.clock.advance(MUSIC_CROSS_S / 8);
      expect(a.level() ** 2 + b.level() ** 2).toBeCloseTo(1, 6);
    }
    w.clock.advance(0.2);
    expect(a.file).toBeNull();
    expect(b.level()).toBe(1);
    // A late second remaining event does not start another crossfade.
    const loads = w.audio.voices.map((v) => v.loads.length);
    b.remaining(MUSIC_CROSS_S + 10);
    expect(w.audio.voices.map((v) => v.loads.length)).toEqual(loads);
  });

  it('goes on at once when a track ends with no crossfade', () => {
    const w = inRun();
    const a = runVoice(w.audio);
    a.end();
    const b = runVoice(w.audio);
    expect(b).not.toBe(a);
    expect(b.playing).toBe(true);
  });

  it('ducks on pause and restores on resume, on the same track', () => {
    const w = inRun();
    const track = runVoice(w.audio);
    w.music.setScene('pause', 1);
    w.clock.advance(MUSIC_PAUSE_FADE_S + 0.05);
    expect(w.audio.part(1)).toBeCloseTo(MUSIC_PAUSE_LEVEL, 9);
    expect(track.playing).toBe(true);
    w.music.setScene('run', 1);
    w.clock.advance(MUSIC_PAUSE_FADE_S + 0.05);
    expect(w.audio.part(1)).toBe(1);
    expect(runVoice(w.audio)).toBe(track);
    expect(track.loads).toHaveLength(1);
  });

  it('goes straight to a fresh track when the run is restarted, even from the pause menu', () => {
    const w = inRun(1);
    const old = runVoice(w.audio);
    w.music.setScene('run', 2);
    const fresh = runVoice(w.audio);
    expect(fresh).not.toBe(old);
    w.clock.advance(MUSIC_RESTART_S / 2);
    expect(old.level() ** 2 + fresh.level() ** 2).toBeCloseTo(1, 6);
    w.clock.advance(MUSIC_RESTART_S);
    expect(old.file).toBeNull();
    expect(w.audio.part(1)).toBe(1);

    w.music.setScene('pause', 2);
    w.clock.advance(1);
    w.music.setScene('run', 3);
    expect(runVoice(w.audio)).not.toBe(fresh);
  });
});

describe('Music: the end of a run', () => {
  it('fades the run out quickly on a crash, then silence, then the lobby back after the beat', () => {
    const w = inRun();
    const run = runVoice(w.audio);
    const lobby = w.audio.lobby();
    const loads = lobby.loads.length;
    w.music.setScene('down', 1);
    w.clock.advance(MUSIC_RUN_OUT_S / 2);
    expect(w.audio.part(1)).toBeGreaterThan(0.1);
    expect(w.audio.part(1)).toBeLessThan(0.95);
    w.clock.advance(MUSIC_RUN_OUT_S / 2 + 0.1);
    expect(w.audio.part(1)).toBe(0);
    expect(run.playing).toBe(false);
    expect(run.file).toBeNull();
    // Game over comes 0.3 s after the crash: the lobby waits out the rest of the beat.
    w.music.setScene('lobby', 1);
    expect(lobby.playing).toBe(false);
    w.clock.advance(MUSIC_LOBBY_BEAT_S - 0.4 - 0.3);
    expect(lobby.playing).toBe(false);
    w.clock.advance(0.4);
    expect(lobby.playing).toBe(true);
    // It picked up where it was, not from the start.
    expect(lobby.loads).toHaveLength(loads);
    w.clock.advance(MUSIC_LOBBY_IN_S + 0.1);
    expect(w.audio.part(0)).toBe(1);
  });

  it('brings the lobby back at once when the crash was long ago', () => {
    const w = inRun();
    w.music.setScene('down', 1);
    w.clock.advance(3);
    w.music.setScene('lobby', 1);
    expect(w.audio.lobby().playing).toBe(true);
  });

  it('leaves the run for the lobby on QUIT from the pause menu, after a beat', () => {
    const w = inRun();
    w.music.setScene('pause', 1);
    w.clock.advance(2);
    w.music.setScene('lobby', 1);
    w.clock.advance(MUSIC_RUN_OUT_S + 0.1);
    expect(w.audio.part(1)).toBe(0);
    expect(w.audio.lobby().playing).toBe(false);
    w.clock.advance(MUSIC_LOBBY_BEAT_S);
    expect(w.audio.lobby().playing).toBe(true);
  });

  it('starts a fresh run track from silence on a retry after a crash', () => {
    const w = inRun(1);
    w.music.setScene('down', 1);
    w.clock.advance(0.2);
    w.music.setScene('run', 2);
    const fresh = runVoice(w.audio);
    expect(fresh.playing).toBe(true);
    w.clock.advance(MUSIC_RESTART_S + 0.1);
    expect(w.audio.part(1)).toBe(1);
  });

  it('does not bring the lobby back after a retry from game over cancelled its beat', () => {
    const w = inRun(1);
    w.music.setScene('down', 1);
    w.clock.advance(0.2);
    w.music.setScene('lobby', 1);
    w.music.setScene('run', 2);
    w.clock.advance(5);
    expect(w.audio.lobby().playing).toBe(false);
    expect(w.audio.part(0)).toBe(0);
  });
});

describe('Music: wanted and failures', () => {
  it('pauses everything when not wanted and picks the lobby up where it was when wanted again', () => {
    const w = inLobby();
    const lobby = w.audio.lobby();
    w.music.setWanted(false);
    expect(lobby.playing).toBe(false);
    w.clock.advance(3);
    w.music.setWanted(true);
    expect(lobby.playing).toBe(true);
    expect(lobby.loads).toHaveLength(1);
    w.clock.advance(MUSIC_FADE_S + 0.1);
    expect(w.audio.part(0)).toBe(1);
  });

  it('resumes a run on the same track after the page was hidden, and does not restart the lobby', () => {
    const w = inRun();
    const track = runVoice(w.audio);
    w.music.setWanted(false);
    w.music.setWanted(true);
    expect(track.playing).toBe(true);
    expect(track.loads).toHaveLength(1);
    expect(w.audio.lobby().playing).toBe(false);
  });

  it('a scene change while not wanted is applied when it comes back', () => {
    const w = inLobby();
    w.music.setWanted(false);
    w.music.setScene('run', 1);
    expect(runVoice_or_none(w.audio)).toBeNull();
    w.music.setWanted(true);
    expect(runVoice(w.audio).file).not.toBe(MUSIC_LOBBY);
  });

  it('is not a failure when the browser wants a gesture: the next nudge plays it', async () => {
    const w = world();
    w.audio.v(0).refuse = 'NotAllowedError';
    w.music.setScene('lobby', 0);
    w.music.setWanted(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(w.audio.v(0).playing).toBe(false);
    expect(w.audio.v(1).loads).toEqual([]);
    w.audio.v(0).refuse = null;
    w.music.setWanted(true);
    expect(w.audio.v(0).playing).toBe(true);
  });

  it('skips a track that cannot be played, and gives up quietly after a few in a row', () => {
    const w = inRun();
    for (let i = 0; i < MUSIC_MAX_FAILS; i++) {
      runVoice(w.audio).fail();
    }
    const loadsAfter = w.audio.voices.reduce((n, v) => n + v.loads.length, 0);
    w.music.setWanted(false);
    w.music.setWanted(true);
    w.music.setWanted(true);
    expect(w.audio.voices.reduce((n, v) => n + v.loads.length, 0)).toBe(loadsAfter);
    expect([w.audio.v(2), w.audio.v(3)].some((v) => v.playing)).toBe(false);
  });

  it('counts only failures in a row: a track that plays clears them', () => {
    const w = inRun();
    for (let i = 0; i < MUSIC_MAX_FAILS - 1; i++) runVoice(w.audio).fail();
    runVoice(w.audio).remaining(100);
    for (let i = 0; i < MUSIC_MAX_FAILS - 1; i++) runVoice(w.audio).fail();
    expect([w.audio.v(2), w.audio.v(3)].some((v) => v.playing)).toBe(true);
  });

  it('unlocks the idle voices on a gesture', () => {
    const w = world();
    w.music.gesture();
    expect(w.audio.primed).toBe(1);
  });
});

function runVoice_or_none(a: FakeAudio): FakeVoice | null {
  return [a.v(2), a.v(3)].find((v) => v.playing) ?? null;
}

describe('the soundtrack files', () => {
  it('lists six tracks, each with a title', () => {
    expect(MUSIC_TRACKS).toHaveLength(6);
    for (const t of MUSIC_TRACKS) expect(t.title.length).toBeGreaterThan(0);
  });

  it('has the lobby track among them, and five others for the run', () => {
    expect(MUSIC_TRACKS.map((t) => t.file)).toContain(MUSIC_LOBBY);
    expect(RUN).toHaveLength(5);
  });

  it('has every listed file in public/music, small enough to stream', () => {
    for (const t of MUSIC_TRACKS) {
      const path = new URL(`../public/music/${t.file}`, import.meta.url);
      expect(existsSync(path), t.file).toBe(true);
      const mb = statSync(path).size / 1e6;
      expect(mb, t.file).toBeGreaterThan(0.5);
      expect(mb, t.file).toBeLessThan(6);
    }
  });
});
