import type { Sfx } from '../platform/audio';
import { flipName } from '../sim/score';
import type { SimEvent } from '../sim/sim';

export interface Toast {
  text: string;
  ttl: number;
  max: number;
  /** Yellow for good news, white for plain information. */
  hot: boolean;
}

type LandEvent = Extract<SimEvent, { type: 'land' }>;

/** How a run feels: turns sim events into sound, toasts, haptics and hit-stop. */
export class Feedback {
  toasts: Toast[] = [];
  /** Seconds the simulation stays frozen after an impact. The render keeps running. */
  hitStop = 0;
  /** Running count of pickups in a row, for the pitch ladder. */
  private streak = 0;
  private lastPickupAt = -10;

  constructor(
    private readonly sfx: Sfx,
    private readonly buzz: (ms: number) => void,
  ) {}

  /** A new run: the pickup clock keeps going, since it only ever compares with the world's age. */
  reset(): void {
    this.toasts = [];
    this.hitStop = 0;
    this.streak = 0;
  }

  showToast(text: string, ttl: number, hot: boolean): void {
    this.toasts = [{ text, ttl, max: ttl, hot }];
  }

  stepToasts(dt: number): void {
    for (const t of this.toasts) t.ttl -= dt;
    if (this.toasts.length > 0 && (this.toasts[0]?.ttl ?? 0) <= 0) this.toasts = [];
  }

  coolHitStop(dt: number): void {
    this.hitStop = Math.max(0, this.hitStop - dt);
  }

  react(e: SimEvent, animT: number): void {
    const sfx = this.sfx;
    switch (e.type) {
      case 'star': {
        this.streak = animT - this.lastPickupAt < 1.1 ? this.streak + 1 : 0;
        this.lastPickupAt = animT;
        sfx.pickup(this.streak);
        this.addHitStop(0.025);
        if (e.lane) this.showToast(`RISK LANE +${e.value}`, 0.9, true);
        break;
      }
      case 'near': {
        this.showToast(e.combo > 1 ? `CLOSE X${e.combo} +${e.pts}` : `CLOSE! +${e.pts}`, 1, true);
        sfx.nearMiss(e.combo);
        this.buzz(12);
        break;
      }
      case 'bush':
        sfx.bush();
        break;
      case 'launch':
        sfx.launch();
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
        this.reactToLanding(e);
        break;
      case 'crash':
        this.addHitStop(0.06);
        sfx.crash();
        this.buzz(60);
        this.toasts = [];
        break;
    }
  }

  private reactToLanding(e: LandEvent): void {
    const sfx = this.sfx;
    if (e.quality !== 'clean') {
      this.showToast('SLOPPY LANDING', 1.1, false);
      sfx.land(false);
      return;
    }
    const name =
      e.flips !== 0
        ? `${e.spin > 0 ? `${e.spin} ` : ''}${flipName(e.flips)}`
        : e.switch
          ? 'SWITCH LANDING'
          : 'CLEAN LANDING';
    if (e.flips !== 0 && e.spin > 0) sfx.trick(6);
    this.showToast(e.pts > 0 ? `${name} +${e.pts}` : name, 1.1, true);
    sfx.land(true);
    this.buzz(18);
  }

  private addHitStop(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds);
  }
}
