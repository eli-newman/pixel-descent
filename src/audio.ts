/** Tiny WebAudio blips. Muted by default; M toggles. Nothing is created until first unmuted. */
export class Sfx {
  muted = true;
  private ctx: AudioContext | null = null;

  toggle(): boolean {
    this.muted = !this.muted;
    if (!this.muted) {
      this.ensure();
      this.tone(660, 0.06, 'square', 0.05);
    }
    return this.muted;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  start(): void {
    this.tone(330, 0.08, 'square', 0.05);
    this.tone(495, 0.1, 'square', 0.05, undefined, 0.08);
  }
  pickup(): void {
    this.tone(880, 0.07, 'square', 0.04, 1320);
  }
  nearMiss(): void {
    this.tone(520, 0.09, 'triangle', 0.07, 900);
  }
  gate(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.1, 'square', 0.05, undefined, i * 0.07));
  }
  bush(): void {
    this.noise(0.12, 0.08);
  }
  crash(): void {
    this.noise(0.35, 0.18);
    this.tone(180, 0.3, 'sawtooth', 0.08, 50);
  }
}
