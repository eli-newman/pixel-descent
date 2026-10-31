/**
 * Procedural WebAudio sound: a continuous wind and snow bed that follows speed, tuck and carving,
 * plus one-shot powder sprays, whooshes and soft chimes. No samples; everything is filtered noise or a quiet sine. Levels are deliberately low.
 * Nothing is created until the first gesture (start or unmute), because browsers block earlier audio.
 */

import { MAX_SPEED } from '../core/config';

const POWDER_COOLDOWN = 0.7;
/** Heading-change rate (see rider.hv) above which a turn throws up a spray of powder. */
const HARD_TURN = 2;
const MASTER = 0.5;

interface Bed {
  wind: GainNode;
  windFilter: BiquadFilterNode;
  hiss: GainNode;
  hissFilter: BiquadFilterNode;
  rumble: GainNode;
}

/** What the ride loop tells the audio each frame. Speeds are px/s. */
export interface RideState {
  speed: number;
  hv: number;
  hx: number;
  /** 0 at cruising speed, 1 at top speed. */
  tuck: number;
  air: boolean;
  active: boolean;
  ice: boolean;
  drift: boolean;
  /** 0..1 swing of the board into a plowing stop. */
  brake: number;
}

/** Semitone offsets of a major pentatonic scale, for rising pickup and combo pitches. */
const LADDER = [0, 2, 4, 7, 9];

/** Frequency `step` rungs up a pentatonic ladder from `base`, capped at about two octaves. */
export function ladderFreq(base: number, step: number): number {
  const n = Math.max(0, Math.min(step, 9));
  return base * Math.pow(2, (LADDER[n % 5] ?? 0) / 12 + Math.floor(n / 5));
}

/** Notes (Hz) the optional background music draws from: A minor pentatonic over two octaves. */
const SCALE = [110, 130.8, 146.8, 164.8, 196, 220, 261.6, 293.7, 329.6, 392];
const PATTERN = [5, 7, 8, 7, 3, 6, 7, 4];

export class Sfx {
  muted = false;
  musicOn = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private bed: Bed | null = null;
  private lastPowder = 0;
  private lastRide = 0;
  private nextNote = 0;
  private noteIdx = 0;

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    if (ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
    }
  }

  /** Called from a gesture after unmuting: creates the audio context if needed and plays a tiny confirmation. */
  wake(): void {
    if (this.ensure()) this.chime(880, 0.04, 0.2);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on) this.nextNote = 0;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(ctx.destination);
    this.noiseBuf = this.makeNoise(ctx);
    this.bed = this.makeBed(ctx);
    return ctx;
  }

  /** Four seconds of soft, slightly low-weighted noise that loops without a click. */
  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b = b * 0.53 + white * 0.07; // gentle low-pass so it sounds like air, not static
      d[i] = (white * 0.12 + b * 3.4) * 0.6;
    }
    return buf;
  }

  private loop(ctx: AudioContext, offset: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  private makeBed(ctx: AudioContext): Bed {
    const out = this.master as GainNode;

    const wind = ctx.createGain();
    wind.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 260;
    windFilter.Q.value = 0.35;
    this.loop(ctx, 0).connect(windFilter).connect(wind).connect(out);
    // Slow gusts: an LFO nudges the wind level so it swells and dips.
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.27;
    lfoDepth.gain.value = 0.01;
    lfo.connect(lfoDepth).connect(wind.gain);
    lfo.start();

    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 1500;
    hissFilter.Q.value = 0.4;
    this.loop(ctx, 1.3).connect(hissFilter).connect(hiss).connect(out);

    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    this.loop(ctx, 2.6).connect(lp).connect(rumble).connect(out);

    return { wind, windFilter, hiss, hissFilter, rumble };
  }

  /**
   * Called every frame. Wind rises in pitch and level with speed, and again with the straight-line
   * tuck; the board hiss follows how hard the rider is carving and goes silent in the air; ice makes
   * it brighter, a snowdrift muffles everything.
   */
  ride(s: RideState): void {
    const ctx = this.ctx;
    const bed = this.bed;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    // The sim steps at 120 Hz; audio parameters only need updating about 30 times a second.
    if (now - this.lastRide < 0.033) return;
    this.lastRide = now;
    const sp = s.active ? Math.min(1, s.speed / MAX_SPEED) : 0;
    const tuck = s.active ? s.tuck : 0;
    const carve = Math.min(1, Math.abs(s.hx) * 0.7 + Math.min(1, Math.abs(s.hv) / 3) * 0.6);
    const muffle = s.drift ? 0.5 : 1;
    bed.wind.gain.setTargetAtTime(
      s.active ? (0.012 + 0.066 * sp * sp + 0.026 * tuck * tuck) * muffle : 0,
      now,
      0.12,
    );
    bed.windFilter.frequency.setTargetAtTime(240 + 560 * sp + 520 * tuck * tuck, now, 0.15);
    bed.windFilter.Q.setTargetAtTime(0.35 + 0.45 * tuck, now, 0.2);
    const grounded = s.active && !s.air;
    bed.hiss.gain.setTargetAtTime(
      grounded
        ? (0.003 + 0.03 * sp * carve + 0.05 * s.brake * (0.3 + sp)) * muffle * (s.ice ? 0.6 : 1)
        : 0,
      now,
      0.08,
    );
    bed.hissFilter.frequency.setTargetAtTime(s.ice ? 3200 : 1500, now, 0.1);
    bed.rumble.gain.setTargetAtTime(grounded ? (0.015 + 0.035 * sp) * muffle : 0, now, 0.15);
    if (
      grounded &&
      Math.abs(s.hv) > HARD_TURN &&
      sp > 0.2 &&
      now - this.lastPowder > POWDER_COOLDOWN
    ) {
      this.lastPowder = now;
      this.powder(Math.min(1, 0.4 + sp * 0.6));
    }
    if (s.active) this.music(ctx, now, sp);
  }

  /** Very quiet generative music, only when switched on: a slow, sparse pentatonic pluck pattern. */
  private music(ctx: AudioContext, now: number, intensity: number): void {
    if (!this.musicOn || this.muted || !this.master) return;
    if (this.nextNote === 0 || this.nextNote < now - 1) this.nextNote = now + 0.1;
    while (this.nextNote < now + 0.25) {
      const i = this.noteIdx++;
      const idx = PATTERN[i % PATTERN.length] ?? 5;
      const f = SCALE[idx % SCALE.length] ?? 220;
      this.pluck(ctx, f, this.nextNote, 0.011, 0.7);
      if (i % 4 === 0) this.pluck(ctx, (SCALE[idx % 5] ?? 110) / 2, this.nextNote, 0.012, 1.4);
      this.nextNote += 0.62 - 0.2 * intensity;
    }
  }

  private pluck(ctx: AudioContext, freq: number, at: number, vol: number, dur: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Filtered noise with a quick attack and a falling band, shaped like a spray of powder. */
  private burst(opts: {
    from: number;
    to: number;
    q: number;
    dur: number;
    vol: number;
    attack?: number;
    delay?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || this.muted || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = opts.q;
    f.frequency.setValueAtTime(opts.from, t0);
    f.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.02;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 3);
    src.stop(t0 + opts.dur + 0.05);
  }

  private chime(freq: number, vol: number, dur: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || this.muted || !this.master) return;
    const t0 = ctx.currentTime + delay;
    for (const [mult, v] of [
      [1, 1],
      [2.01, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  private thump(vol: number, from = 110, to = 32): void {
    const ctx = this.ensure();
    if (!ctx || this.muted || !this.master) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + 0.4);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  }

  /** A hard carve throws a short, bright spray. */
  powder(amount: number): void {
    this.burst({ from: 2000, to: 800, q: 0.5, dur: 0.4, vol: 0.05 * amount, attack: 0.025 });
    this.burst({ from: 700, to: 300, q: 0.5, dur: 0.3, vol: 0.03 * amount, attack: 0.03 });
  }

  start(): void {
    this.ensure();
    this.burst({ from: 300, to: 2400, q: 0.5, dur: 0.6, vol: 0.05, attack: 0.25 });
    this.chime(523, 0.025, 0.3);
  }

  /** Grabbing stars in a row climbs a pentatonic ladder. */
  pickup(streak = 0): void {
    this.chime(ladderFreq(784, streak), 0.03, 0.2);
  }

  /** A near miss is a whoosh plus a chime whose pitch climbs with the combo. */
  nearMiss(combo = 1): void {
    this.burst({ from: 300, to: 1400, q: 0.6, dur: 0.3, vol: 0.05, attack: 0.1 });
    this.chime(ladderFreq(523, Math.max(0, combo - 1)), 0.022, 0.28, 0.05);
  }

  bush(): void {
    this.burst({ from: 1200, to: 400, q: 0.5, dur: 0.28, vol: 0.06, attack: 0.02 });
  }

  /** Kicker take-off: a rising whoosh. */
  launch(): void {
    this.burst({ from: 400, to: 2200, q: 0.5, dur: 0.45, vol: 0.05, attack: 0.15 });
  }

  /** A finished trick: a quick two note lift, higher for each extra trick. */
  trick(n = 1): void {
    this.chime(ladderFreq(659, n), 0.026, 0.22);
    this.chime(ladderFreq(659, n + 2), 0.022, 0.3, 0.07);
  }

  /** Touchdown: a soft thud and spray when clean, a rougher scrape when sloppy. */
  land(clean: boolean): void {
    if (clean) {
      this.thump(0.12, 150, 55);
      this.burst({ from: 1800, to: 600, q: 0.5, dur: 0.35, vol: 0.05, attack: 0.02 });
    } else {
      this.thump(0.16, 120, 40);
      this.burst({ from: 1400, to: 300, q: 0.4, dur: 0.5, vol: 0.08, attack: 0.02 });
    }
  }

  crash(): void {
    this.thump(0.25);
    this.burst({ from: 2200, to: 500, q: 0.4, dur: 0.9, vol: 0.14, attack: 0.015 });
    this.burst({ from: 500, to: 180, q: 0.5, dur: 0.7, vol: 0.08, attack: 0.02, delay: 0.04 });
  }
}
