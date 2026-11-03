export type Action =
  | 'start'
  | 'trick'
  | 'pause'
  | 'mute'
  | 'retry'
  | 'share'
  | 'hud'
  | 'music'
  | 'manual'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'back';

export type InputItem = { kind: 'action'; action: Action } | { kind: 'tap'; x: number; y: number };

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const FLIP_UP = new Set(['ArrowUp', 'KeyW']);
const FLIP_DOWN = new Set(['ArrowDown', 'KeyS']);
const ACTION_KEYS: Record<string, Action> = {
  Space: 'start',
  Enter: 'start',
  KeyP: 'pause',
  Escape: 'back',
  KeyM: 'mute',
  KeyR: 'retry',
  KeyT: 'trick',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  KeyC: 'share',
  KeyH: 'hud',
  KeyU: 'music',
  KeyG: 'manual',
};
/** A touch that moves farther than this (CSS px) switches from "hold a side" to "drag to steer". */
const DRAG_START = 10;
/** CSS px of dragging for full steering lock. */
const DRAG_RANGE = 56;
/** A sideways flick this far (CSS px) within SWIPE_MS of the touch is a spin. Past half of DRAG_RANGE, so the spin direction is already steered. */
const SWIPE_MIN = 32;
const SWIPE_MS = 280;
/** A vertical flick this far (CSS px) within any SWIPE_MS of the touch is a flip. Shorter than SWIPE_MIN, since a thumb flick up or down is short. */
const FLIP_SWIPE_MIN = 24;
/**
 * Flick angles. A flick is vertical unless its sideways part is more than SWIPE_SLANT times its vertical
 * part (about 51 degrees off vertical), so a slanted thumb flick down is still a flip and only a clearly
 * sideways one is a spin. Every quick flick is one or the other.
 */
const SWIPE_SLANT = 1.25;
/**
 * A finger that lands on a half only holds that side (steer, or spin in the air) after HOLD_MS still,
 * or once it has moved and SWIPE_MS has passed with no flick. Holding at once made every flick start
 * with a spin: in the air one step of hold commits a half turn, so a swipe down came out as a 180.
 */
const HOLD_MS = 80;

function preventDefault(e: Event): void {
  e.preventDefault();
}

/** Keyboard, mouse and touch input collected into a steering value and a queue of actions and taps. */
export class Input {
  private readonly keys = new Set<string>();
  private queue: InputItem[] = [];
  private pointerId: number | null = null;
  private pointerX0 = 0;
  private pointerSteer = 0;
  private dragging = false;
  private pointerT0 = 0;
  private pointerY0 = 0;
  /** When this touch landed, on the `now` clock (event timeStamps may use another clock). */
  private holdT0 = 0;
  /** The side this touch holds (-1 left, 1 right), or 0 once it holds, drags or has swiped. */
  private holdSide: -1 | 0 | 1 = 0;
  /** True once this touch has moved past DRAG_START: it is not a still hold any more. */
  private moved = false;
  /** Recent positions of this touch, oldest first, for vertical flicks that start after the touch. */
  private trail: Array<{ x: number; y: number; t: number }> = [];
  /** True once this touch has been used for a swipe, so it fires once. */
  private swiped = false;
  /** Fingers currently down (touch only): two or more is the brake. */
  private readonly touches = new Set<number>();
  private readonly cleanup: Array<() => void> = [];
  /** True once a touch has been seen: the game shows touch hints. */
  usingTouch = false;
  /** Set by the game so taps can be reported in logical (180x320) coordinates. */
  logical: (clientX: number, clientY: number) => { x: number; y: number } = (x, y) => ({ x, y });

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Milliseconds, for how long a touch has been held. Tests pass a fake one. */
    private readonly now: () => number = () => performance.now(),
  ) {
    this.on(window, 'keydown', this.onKeyDown);
    this.on(window, 'keyup', this.onKeyUp);
    this.on(window, 'blur', () => this.releaseAll());
    this.on(window, 'pointerdown', this.onPointerDown);
    this.on(window, 'pointermove', this.onPointerMove);
    this.on(window, 'pointerup', this.onPointerUp);
    this.on(window, 'pointercancel', this.onPointerUp);
    // Two fingers must never pinch-zoom the page: iOS Safari ignores user-scalable=no, so cancel the gesture and any touch move.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      window.addEventListener(type, preventDefault);
      this.cleanup.push(() => window.removeEventListener(type, preventDefault));
    }
    this.on(window, 'touchmove', preventDefault, { passive: false });
    this.on(window, 'touchend', this.onTouchEnd, { passive: false });
  }

  /** Steering in [-1, 1]: negative is left (toe side), positive is right (heel side). */
  steer(): number {
    this.settleHold();
    let k = 0;
    for (const code of this.keys) {
      if (LEFT.has(code)) k -= 1;
      if (RIGHT.has(code)) k += 1;
    }
    // Two fingers are the brake: like holding both arrows, they cancel out and do not steer.
    if (this.touches.size >= 2) return Math.max(-1, Math.min(1, k));
    return Math.max(-1, Math.min(1, k + this.pointerSteer));
  }

  /** Flip keys held: 1 is a backflip (Down, S), -1 a frontflip (Up, W), 0 when none or both. */
  flip(): -1 | 0 | 1 {
    let up = false;
    let down = false;
    for (const code of this.keys) {
      if (FLIP_UP.has(code)) up = true;
      if (FLIP_DOWN.has(code)) down = true;
    }
    return up === down ? 0 : up ? -1 : 1;
  }

  /** True while a left key and a right key are held together, or two fingers are down. */
  brake(): boolean {
    if (this.touches.size >= 2) return true;
    let l = false;
    let r = false;
    for (const code of this.keys) {
      if (LEFT.has(code)) l = true;
      if (RIGHT.has(code)) r = true;
    }
    return l && r;
  }

  /** Take everything queued since the last call. The returned array is only valid until the next call. */
  drain(): InputItem[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  push(action: Action): void {
    this.queue.push({ kind: 'action', action });
  }

  releaseAll(): void {
    this.keys.clear();
    this.pointerId = null;
    this.pointerSteer = 0;
    this.holdSide = 0;
    this.dragging = false;
    this.touches.clear();
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }

  private on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }

  /** Quick taps must never zoom the page: iOS Safari also ignores user-scalable=no for double taps. Buttons still need their click. */
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = ACTION_KEYS[e.code];
    if (action || LEFT.has(e.code) || RIGHT.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (action) this.push(action);
      if (LEFT.has(e.code)) this.push('left');
      if (RIGHT.has(e.code)) this.push('right');
    }
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (e.pointerType === 'touch') {
      this.usingTouch = true;
      this.touches.add(e.pointerId);
    }
    const p = this.logical(e.clientX, e.clientY);
    this.queue.push({ kind: 'tap', x: p.x, y: p.y });
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.pointerX0 = e.clientX;
    this.pointerY0 = e.clientY;
    this.pointerT0 = e.timeStamp;
    this.swiped = false;
    this.dragging = false;
    this.moved = false;
    this.trail.length = 0;
    this.trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    // The side is held only once this is clearly not a flick: see HOLD_MS.
    const rect = this.canvas.getBoundingClientRect();
    this.holdT0 = this.now();
    this.holdSide = e.clientX < rect.left + rect.width / 2 ? -1 : 1;
    this.pointerSteer = 0;
  };

  /** Start holding the touched side once the touch has stayed still for HOLD_MS, or moved without a flick for SWIPE_MS. */
  private settleHold(): void {
    if (this.holdSide === 0) return;
    const t = this.now() - this.holdT0;
    if (t < (this.moved ? SWIPE_MS : HOLD_MS)) return;
    this.pointerSteer = this.holdSide;
    this.holdSide = 0;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.pointerX0;
    const dy = e.clientY - this.pointerY0;
    const early = e.timeStamp - this.pointerT0 <= SWIPE_MS;
    if (Math.abs(dx) > DRAG_START || Math.abs(dy) > DRAG_START) this.moved = true;
    if (!this.swiped && this.touches.size < 2) {
      // A vertical flick counts within SWIPE_MS of any point of the touch, so resting the thumb first still works.
      const trail = this.trail;
      while (trail.length > 1 && e.timeStamp - (trail[0]?.t ?? 0) > SWIPE_MS) trail.shift();
      const from = trail[0] ?? { x: this.pointerX0, y: this.pointerY0 };
      trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      const fx = e.clientX - from.x;
      const fy = e.clientY - from.y;
      if (Math.abs(fy) >= FLIP_SWIPE_MIN && Math.abs(fx) <= Math.abs(fy) * SWIPE_SLANT) {
        // Down is the trick shown as FRONTFLIP and up the BACKFLIP, like the keys. The flick does not steer.
        this.swiped = true;
        this.holdSide = 0;
        this.pointerSteer = 0;
        this.push(fy < 0 ? 'up' : 'down');
        return;
      }
      if (early && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * SWIPE_SLANT) {
        // A sideways flick is a spin that way: the drag below has already steered that direction.
        this.swiped = true;
        this.holdSide = 0;
        this.pointerSteer = Math.max(-1, Math.min(1, dx / DRAG_RANGE));
        this.push('trick');
        return;
      }
    }
    // While a flick could still be vertical, or after one, a slanted move must not steer: past SPIN_STEER it would spin.
    const sideways = Math.abs(dx) > Math.abs(dy) * SWIPE_SLANT;
    if (this.swiped && !sideways) return;
    if (!this.dragging && Math.abs(dx) > DRAG_START && (sideways || !early)) {
      this.dragging = true;
      this.holdSide = 0;
    }
    if (this.dragging) this.pointerSteer = Math.max(-1, Math.min(1, dx / DRAG_RANGE));
    else this.settleHold();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pointerSteer = 0;
    this.holdSide = 0;
    this.dragging = false;
  };
}
