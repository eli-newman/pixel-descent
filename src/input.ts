export type Action = 'start' | 'pause' | 'mute' | 'retry';

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const ACTION_KEYS: Record<string, Action> = {
  Space: 'start',
  Enter: 'start',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  KeyR: 'retry',
};
/** A touch that moves farther than this (CSS px) switches from "hold a side" to "drag to steer". */
const DRAG_START = 10;
/** CSS px of dragging for full steering lock. */
const DRAG_RANGE = 56;

/** Keyboard, mouse and touch input collected into a steering value and a queue of actions. */
export class Input {
  private readonly keys = new Set<string>();
  private readonly queue: Action[] = [];
  private pointerId: number | null = null;
  private pointerX0 = 0;
  private pointerSteer = 0;
  private dragging = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.on(window, 'keydown', this.onKeyDown);
    this.on(window, 'keyup', this.onKeyUp);
    this.on(window, 'blur', () => this.releaseAll());
    this.on(window, 'pointerdown', this.onPointerDown);
    this.on(window, 'pointermove', this.onPointerMove);
    this.on(window, 'pointerup', this.onPointerUp);
    this.on(window, 'pointercancel', this.onPointerUp);
  }

  /** Steering in [-1, 1]: negative is left (toe side), positive is right (heel side). */
  steer(): number {
    let k = 0;
    for (const code of this.keys) {
      if (LEFT.has(code)) k -= 1;
      if (RIGHT.has(code)) k += 1;
    }
    return Math.max(-1, Math.min(1, k + this.pointerSteer));
  }

  /** Take all actions since the last call. */
  drain(): Action[] {
    return this.queue.splice(0, this.queue.length);
  }

  push(action: Action): void {
    this.queue.push(action);
  }

  releaseAll(): void {
    this.keys.clear();
    this.pointerId = null;
    this.pointerSteer = 0;
    this.dragging = false;
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }

  private on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
  ): void {
    target.addEventListener(type, handler);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = ACTION_KEYS[e.code];
    if (action || LEFT.has(e.code) || RIGHT.has(e.code)) e.preventDefault();
    if (action && !e.repeat) this.queue.push(action);
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    this.queue.push('start');
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.pointerX0 = e.clientX;
    this.dragging = false;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerSteer = e.clientX < rect.left + rect.width / 2 ? -1 : 1;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.pointerX0;
    if (!this.dragging && Math.abs(dx) > DRAG_START) this.dragging = true;
    if (this.dragging) this.pointerSteer = Math.max(-1, Math.min(1, dx / DRAG_RANGE));
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pointerSteer = 0;
    this.dragging = false;
  };
}
