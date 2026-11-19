import { describe, expect, it } from 'vitest';
import { MUSIC_FADE_S, MUSIC_MAX_FAILS, MUSIC_PREFETCH_S, MUSIC_TRACKS } from '../src/core/config';
import { Music, Playlist, type Track, type TrackSource } from '../src/platform/music';
import { Rng } from '../src/core/rng';
import { existsSync, statSync } from 'node:fs';

/** A track that records what it is told and lets the test play the part of the browser. */
class FakeTrack implements Track {
  isPaused = true;
  disposed = false;
  fades: Array<[number, number]> = [];
  plays = 0;
  /** What the next play() does: resolve, or reject with an error of this name. */
  refuse: string | null = null;
  private remainingCb: (s: number) => void = () => {};
  private endedCb: () => void = () => {};
  private errorCb: () => void = () => {};
  constructor(
    readonly file: string,
    readonly prefetch: boolean,
  ) {}
  play(): Promise<void> {
    this.plays++;
    if (this.refuse) {
      const e = new Error('refused');
      e.name = this.refuse;
      return Promise.reject(e);
    }
    this.isPaused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.isPaused = true;
  }
  paused(): boolean {
    return this.isPaused;
  }
  fadeTo(level: number, seconds: number): void {
    this.fades.push([level, seconds]);
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
    this.disposed = true;
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

class FakeSource implements TrackSource {
  opened: FakeTrack[] = [];
  open(file: string, prefetch: boolean): Track {
    const t = new FakeTrack(file, prefetch);
    this.opened.push(t);
    return t;
  }
  last(): FakeTrack {
    const t = this.opened[this.opened.length - 1];
    if (!t) throw new Error('nothing opened');
    return t;
  }
}

const FILES = MUSIC_TRACKS.map((t) => t.file);

function player(seed = 1): { music: Music; source: FakeSource } {
  const source = new FakeSource();
  const rng = new Rng(seed);
  return { music: new Music(FILES, source, () => rng.next()), source };
}

describe('Playlist', () => {
  it('plays every track once per round, in a shuffled order', () => {
    const p = new Playlist(6, () => 0.37);
    const round = Array.from({ length: 6 }, () => p.next());
    expect([...round].sort()).toEqual([0, 1, 2, 3, 4, 5]);
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

  it('is the same order for the same random source', () => {
    const a = new Playlist(6, () => 0.5);
    const b = new Playlist(6, () => 0.5);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('copes with one track and with none', () => {
    const one = new Playlist(1, () => 0.5);
    expect([one.next(), one.next()]).toEqual([0, 0]);
    expect(new Playlist(0, () => 0.5).next()).toBe(-1);
  });
});

describe('Music', () => {
  it('opens nothing until it is wanted', () => {
    const { music, source } = player();
    expect(source.opened).toHaveLength(0);
    expect(music.playing).toBe(-1);
  });

  it('starts a track with a fade in when wanted, and stops when not', () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    expect(t.plays).toBe(1);
    expect(t.prefetch).toBe(false);
    expect(t.fades).toEqual([
      [0, 0],
      [1, MUSIC_FADE_S],
    ]);
    music.setWanted(false);
    expect(t.paused()).toBe(true);
  });

  it('comes back to the same track, fading in again', () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    music.setWanted(false);
    music.setWanted(true);
    expect(source.opened).toHaveLength(1);
    expect(t.plays).toBe(2);
    expect(t.fades.at(-1)).toEqual([1, MUSIC_FADE_S]);
  });

  it('does not restart the fade when nudged while playing', () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    for (let i = 0; i < 5; i++) music.setWanted(true);
    expect(t.plays).toBe(1);
    expect(t.fades).toHaveLength(2);
  });

  it('starts it again after the system paused it (an iOS interruption)', () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    t.pause();
    music.setWanted(true);
    expect(t.plays).toBe(2);
  });

  it('prefetches the next track near the end, then plays it when the first ends', () => {
    const { music, source } = player();
    music.setWanted(true);
    const first = source.last();
    first.remaining(MUSIC_PREFETCH_S + 5);
    expect(source.opened).toHaveLength(1);
    first.remaining(MUSIC_PREFETCH_S);
    first.remaining(MUSIC_PREFETCH_S - 1);
    expect(source.opened).toHaveLength(2);
    const second = source.last();
    expect(second.prefetch).toBe(true);
    expect(second.plays).toBe(0);
    first.end();
    expect(first.disposed).toBe(true);
    expect(second.plays).toBe(1);
    expect(second.file).not.toBe(first.file);
  });

  it('opens the next track when the first ends with no prefetch', () => {
    const { music, source } = player();
    music.setWanted(true);
    source.last().end();
    expect(source.opened).toHaveLength(2);
    expect(source.last().plays).toBe(1);
  });

  it('plays every track once before any repeats', () => {
    const { music, source } = player();
    music.setWanted(true);
    for (let i = 0; i < FILES.length - 1; i++) source.last().end();
    expect(new Set(source.opened.map((t) => t.file)).size).toBe(FILES.length);
  });

  it('keeps the next track ready, unplayed, while muted when a track ends', () => {
    const { music, source } = player();
    music.setWanted(true);
    const first = source.last();
    music.setWanted(false);
    first.end();
    const second = source.last();
    expect(second.plays).toBe(0);
    music.setWanted(true);
    expect(second.plays).toBe(1);
  });

  it('is not a failure when the browser wants a gesture: it tries again on the next nudge', async () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    t.refuse = 'NotAllowedError';
    t.pause();
    music.setWanted(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(source.opened).toHaveLength(1);
    expect(music.gaveUp).toBe(false);
    t.refuse = null;
    music.setWanted(true);
    expect(t.isPaused).toBe(false);
  });

  it('skips a track that cannot be fetched or decoded, and gives up quietly after a few in a row', () => {
    const { music, source } = player();
    music.setWanted(true);
    for (let i = 0; i < MUSIC_MAX_FAILS; i++) source.last().fail();
    expect(source.opened).toHaveLength(MUSIC_MAX_FAILS);
    expect(music.gaveUp).toBe(true);
    music.setWanted(false);
    music.setWanted(true);
    expect(source.opened).toHaveLength(MUSIC_MAX_FAILS);
  });

  it('counts only failures in a row: a track that plays through clears them', () => {
    const { music, source } = player();
    music.setWanted(true);
    source.last().fail();
    source.last().fail();
    source.last().end();
    source.last().fail();
    source.last().fail();
    expect(music.gaveUp).toBe(false);
  });

  it('treats a play that fails for another reason as a failed track', async () => {
    const { music, source } = player();
    music.setWanted(true);
    const t = source.last();
    t.refuse = 'NotSupportedError';
    t.pause();
    music.setWanted(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(source.opened).toHaveLength(2);
  });
});

describe('the soundtrack files', () => {
  it('lists six tracks, each with a title', () => {
    expect(MUSIC_TRACKS).toHaveLength(6);
    for (const t of MUSIC_TRACKS) expect(t.title.length).toBeGreaterThan(0);
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
