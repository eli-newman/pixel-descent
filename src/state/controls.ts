import type { Sfx } from '../platform/audio';
import type { Action, Input } from '../platform/input';
import { randomSeedString } from '../core/rng';
import type { SimInput } from '../sim/sim';
import { menuButtons, type ButtonId, type Phase, type Screen } from './menu';
import { BOARDS, cycleGear, RIDERS } from './progress';
import type { Store } from './storage';

/** What the controls can ask the game to do. */
export interface ControlsHost {
  readonly phase: Phase;
  readonly seed: string;
  readonly today: string;
  /** The game over panel has been up long enough to accept a restart. */
  readonly overReady: boolean;
  begin(): void;
  newRun(seed: string, play?: boolean): void;
  togglePause(): void;
  share(): Promise<void>;
  setManualSpin(on: boolean): void;
}

export interface ControlsDeps {
  input: Input;
  sfx: Sfx;
  store: Store;
  announce?: (text: string) => void;
}

/** Turns taps, keys and buttons into game actions. Owns the menu position and the queued tricks. */
export class Controls {
  screen: Screen = 'main';
  scoreTab: 'top' | 'daily' = 'top';
  /** Keyboard focus in the current button list, and whether to draw it. */
  focus = 0;
  focusVisible = false;
  private trickQueued = false;
  /** A flip pressed since the last step (a fast tap or a touch button): 1 back, -1 front. */
  private flipQueued: -1 | 0 | 1 = 0;
  /** The input of the latest step. A crashed rider keeps tumbling on it. */
  readonly simInput: SimInput = { steer: 0, trick: false, brake: false, flip: 0 };

  constructor(
    private readonly host: ControlsHost,
    private readonly deps: ControlsDeps,
  ) {}

  get phase(): Phase {
    return this.host.phase;
  }

  /** A new run: back to the main screen with nothing queued. */
  reset(): void {
    this.trickQueued = false;
    this.flipQueued = 0;
    this.screen = 'main';
    this.resetFocus();
  }

  resetFocus(): void {
    this.focus = 0;
    this.focusVisible = false;
  }

  /** Read the devices and the queued presses into the input for the next sim step. */
  readSimInput(): SimInput {
    const { input } = this.deps;
    const si = this.simInput;
    si.steer = input.steer();
    si.brake = input.brake();
    si.trick = this.trickQueued;
    this.trickQueued = false;
    si.flip = this.flipQueued !== 0 ? this.flipQueued : input.flip();
    this.flipQueued = 0;
    return si;
  }

  handleInput(): void {
    for (const item of this.deps.input.drain()) {
      if (item.kind === 'tap') this.handleTap(item.x, item.y);
      else this.handleAction(item.action);
    }
  }

  private handleTap(x: number, y: number): void {
    const host = this.host;
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
    switch (host.phase) {
      case 'title':
        if (this.screen === 'main') host.begin();
        else this.screen = 'main';
        break;
      case 'paused':
        host.togglePause();
        break;
      case 'over':
        if (host.overReady) host.newRun(randomSeedString(), true);
        break;
      default:
        break;
    }
  }

  private get playing(): boolean {
    return this.host.phase === 'playing';
  }

  private handleAction(action: Action): void {
    this.onAction[action]();
  }

  /** What each key does. A Record, so a new action does not compile until it is handled here. */
  private readonly onAction: Record<Action, () => void> = {
    mute: () => this.setMuted(!this.deps.sfx.muted),
    music: () => this.toggleSetting('music'),
    hud: () => this.toggleSetting('bigHud'),
    manual: () => this.toggleSetting('manualSpin'),
    pause: () => this.host.togglePause(),
    trick: () => {
      if (this.playing) this.trickQueued = true;
    },
    up: () => this.flipOrFocus(-1, -1),
    down: () => this.flipOrFocus(1, 1),
    left: () => this.cycleFocusedGear(-1),
    right: () => this.cycleFocusedGear(1),
    start: () => this.startAction(),
    back: () => this.backAction(),
    retry: () => {
      const { phase } = this.host;
      if (phase === 'over' || phase === 'paused' || phase === 'crashed') {
        this.host.newRun(this.host.seed, true);
      }
    },
    share: () => {
      if (this.host.phase === 'over') this.press('share');
    },
  };

  /** While riding the arrow flips; in a menu it moves the focus. */
  private flipOrFocus(flip: -1 | 1, focus: -1 | 1): void {
    if (this.playing) this.flipQueued = flip;
    else this.moveFocus(focus);
  }

  private cycleFocusedGear(dir: 1 | -1): void {
    if (this.host.phase === 'title' && this.screen === 'gear') {
      this.cycleGear(this.focus >= 3 ? 'rider' : 'board', dir);
    }
  }

  private startAction(): void {
    const host = this.host;
    if (this.playing) {
      this.trickQueued = true;
      return;
    }
    this.focusVisible = this.focusVisible && host.phase !== 'title';
    const bt = menuButtons(this)[this.focus] ?? menuButtons(this)[0];
    if (bt) this.press(bt.id);
    else if (host.phase === 'over' && host.overReady) host.newRun(randomSeedString(), true);
  }

  private backAction(): void {
    const host = this.host;
    if (this.playing || host.phase === 'paused') host.togglePause();
    else if (host.phase === 'title' && this.screen !== 'main') this.screen = 'main';
  }

  /** Run the action behind a button. */
  press(id: ButtonId): void {
    this.onButton[id]();
  }

  /** What each button does. A Record, so a new button does not compile until it is handled here. */
  private readonly onButton: Record<ButtonId, () => void> = {
    play: () => this.host.begin(),
    daily: () => this.host.newRun(this.host.today, true),
    scores: () => {
      this.scoreTab = 'top';
      this.openScreen('scores');
    },
    gear: () => this.openScreen('gear'),
    goals: () => this.openScreen('goals'),
    back: () => this.openScreen('main'),
    tabTop: () => {
      this.scoreTab = 'top';
    },
    tabDaily: () => {
      this.scoreTab = 'daily';
    },
    sound: () => this.setMuted(!this.deps.sfx.muted),
    music: () => this.toggleSetting('music'),
    hud: () => this.toggleSetting('bigHud'),
    autopause: () => this.toggleSetting('autoPause'),
    manual: () => this.toggleSetting('manualSpin'),
    boardPrev: () => this.cycleGear('board', -1),
    boardNext: () => this.cycleGear('board', 1),
    riderPrev: () => this.cycleGear('rider', -1),
    riderNext: () => this.cycleGear('rider', 1),
    resume: () => this.host.togglePause(),
    restart: () => this.host.newRun(this.host.seed, true),
    quit: () => this.host.newRun(randomSeedString()),
    menu: () => this.host.newRun(randomSeedString()),
    again: () => {
      if (this.host.overReady) this.host.newRun(randomSeedString(), true);
    },
    retry: () => {
      if (this.host.overReady) this.host.newRun(this.host.seed, true);
    },
    share: () => void this.host.share(),
  };

  private setMuted(muted: boolean): void {
    const { store, sfx, announce } = this.deps;
    store.saveSettings({ muted });
    sfx.setMuted(muted);
    if (!muted) sfx.wake();
    announce?.(muted ? 'Sound off.' : 'Sound on.');
  }

  private toggleSetting(key: 'music' | 'bigHud' | 'autoPause' | 'manualSpin'): void {
    const { store, sfx, announce } = this.deps;
    const next = !store.settings()[key];
    store.saveSettings({ [key]: next });
    if (key === 'music') sfx.setMusic(next);
    if (key === 'manualSpin') this.host.setManualSpin(next);
    announce?.(`${key} ${next ? 'on' : 'off'}.`);
  }

  private moveFocus(dir: 1 | -1): void {
    const n = menuButtons(this).length;
    if (n === 0) return;
    this.focusVisible = true;
    this.focus = (this.focus + dir + n) % n;
  }

  private cycleGear(which: 'board' | 'rider', dir: 1 | -1): void {
    const { store } = this.deps;
    const p = store.progress();
    const list = which === 'board' ? BOARDS : RIDERS;
    p.gear[which] = cycleGear(list, p.gear[which], p, dir);
    store.saveProgress();
  }

  private openScreen(screen: Screen): void {
    this.screen = screen;
    this.resetFocus();
  }
}
