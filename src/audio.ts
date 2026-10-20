/**
 * Procedural WebAudio sound: a continuous wind and snow bed that follows speed and carving, plus
 * one-shot powder sprays, whooshes and soft chimes. No samples; everything is filtered noise.
 * Nothing is created until the first gesture (start or unmute), because browsers block earlier audio.
 */

const MAX_SPEED = 240;
const POWDER_COOLDOWN = 0.7;
/** Heading-change rate (see rider.hv) above which a turn throws up a spray of powder. */
const HARD_TURN = 2;

interface Bed {
  wind: GainNode;
  windFilter: BiquadFilterNode;
  hiss: GainNode;
  rumble: GainNode;
}

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private bed: Bed | null = null;
  private lastPowder = 0;

  toggle(): boolean {
    this.muted = !this.muted;
    const ctx = this.ensure();
    if (ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, ctx.currentTime, 0.05);
      if (!this.muted) this.chime(880, 0.04, 0.2);
    }
    return this.muted;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
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
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1500;
    hp.Q.value = 0.4;
    this.loop(ctx, 1.3).connect(hp).connect(hiss).connect(out);

    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    this.loop(ctx, 2.6).connect(lp).connect(rumble).connect(out);

    return { wind, windFilter, hiss, rumble };
  }

  /**
   * Called every frame. speed is px/s, hv the carve's rate of change, active is true only while riding.
   * Wind rises in pitch and level with speed; the board hiss and spray follow how hard he is carving.
   */
  ride(speed: number, hv: number, hx: number, active: boolean): void {
    const ctx = this.ctx;
    const bed = this.bed;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    const s = active ? Math.min(1, speed / MAX_SPEED) : 0;
    const carve = Math.min(1, Math.abs(hx) * 0.7 + Math.min(1, Math.abs(hv) / 3) * 0.6);
    bed.wind.gain.setTargetAtTime(active ? 0.012 + 0.07 * s * s : 0, now, 0.12);
    bed.windFilter.frequency.setTargetAtTime(240 + 650 * s, now, 0.15);
    bed.hiss.gain.setTargetAtTime(active ? 0.003 + 0.03 * s * carve : 0, now, 0.08);
    bed.rumble.gain.setTargetAtTime(active ? 0.015 + 0.035 * s : 0, now, 0.15);
    if (active && Math.abs(hv) > HARD_TURN && s > 0.2 && now - this.lastPowder > POWDER_COOLDOWN) {
      this.lastPowder = now;
      this.powder(Math.min(1, 0.4 + s * 0.6));
    }
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

  private thump(vol: number): void {
    const ctx = this.ensure();
    if (!ctx || this.muted || !this.master) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.4);
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
  pickup(): void {
    this.chime(988, 0.03, 0.2);
  }
  nearMiss(): void {
    this.burst({ from: 300, to: 1400, q: 0.6, dur: 0.3, vol: 0.05, attack: 0.1 });
  }
  gate(): void {
    [523, 659, 784].forEach((f, i) => this.chime(f, 0.03, 0.5, i * 0.08));
  }
  bush(): void {
    this.burst({ from: 1200, to: 400, q: 0.5, dur: 0.28, vol: 0.06, attack: 0.02 });
  }
  crash(): void {
    this.thump(0.25);
    this.burst({ from: 2200, to: 500, q: 0.4, dur: 0.9, vol: 0.14, attack: 0.015 });
    this.burst({ from: 500, to: 180, q: 0.5, dur: 0.7, vol: 0.08, attack: 0.02, delay: 0.04 });
  }
}
