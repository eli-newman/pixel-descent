import { quantiseSteer, STEER_STEPS, type SimInput } from './sim';

/**
 * A run is fully described by its seed and the inputs at each fixed step, so a replay is just a
 * list of input changes. `changes` holds pairs [step, code]: from that step on, the input is the
 * code (steering in eighths, plus trick, brake and flip bits).
 */
export interface Replay {
  seed: string;
  touch: boolean;
  /** Manual spin was on. Absent in older replays, which were all assisted. */
  manual?: boolean;
  /** Total steps the run lasted, up to the crash. */
  steps: number;
  score: number;
  dist: number;
  changes: number[];
}

const TRICK_BIT = 64;
const BRAKE_BIT = 128;
/** Flip key bits. Older replays never set them, so they play with no flips. */
const FLIP_UP_BIT = 256;
const FLIP_DOWN_BIT = 512;
const STEER_BIAS = STEER_STEPS;

function encode(input: SimInput): number {
  const s = Math.round(quantiseSteer(input.steer) * STEER_STEPS) + STEER_BIAS;
  const flip = input.flip === 1 ? FLIP_UP_BIT : input.flip === -1 ? FLIP_DOWN_BIT : 0;
  return s | (input.trick ? TRICK_BIT : 0) | (input.brake ? BRAKE_BIT : 0) | flip;
}

/** Records the input of each step, keeping only the steps where it changes. */
export class ReplayRecorder {
  private readonly changes: number[] = [];
  private last = -1;
  private step = 0;

  record(input: SimInput): void {
    const code = encode(input);
    if (code !== this.last) {
      this.changes.push(this.step, code);
      this.last = code;
    }
    this.step++;
  }

  finish(seed: string, touch: boolean, score: number, dist: number, manual = false): Replay {
    const replay: Replay = {
      seed,
      touch,
      steps: this.step,
      score,
      dist,
      changes: this.changes.slice(),
    };
    if (manual) replay.manual = true;
    return replay;
  }

  get steps(): number {
    return this.step;
  }
}

/** The sim options a replay needs to play back exactly (`new Sim(replay.seed, replayOptions(replay))`). */
export function replayOptions(replay: Replay): { touch: boolean; manualSpin: boolean } {
  return { touch: replay.touch, manualSpin: replay.manual === true };
}

/** Plays a replay back one step at a time. */
export class ReplayPlayer {
  private idx = 0;
  private code = STEER_BIAS;
  private readonly out: SimInput = { steer: 0, trick: false, brake: false, flip: 0 };

  constructor(readonly replay: Replay) {}

  /** The input for the given step. Steps must be asked for in increasing order. Returns a reused object. */
  at(step: number): SimInput {
    const ch = this.replay.changes;
    while (this.idx < ch.length && (ch[this.idx] ?? Infinity) <= step) {
      this.code = ch[this.idx + 1] ?? STEER_BIAS;
      this.idx += 2;
    }
    this.out.steer = ((this.code & (TRICK_BIT - 1)) - STEER_BIAS) / STEER_STEPS;
    this.out.trick = (this.code & TRICK_BIT) !== 0;
    this.out.brake = (this.code & BRAKE_BIT) !== 0;
    this.out.flip =
      (this.code & FLIP_UP_BIT) !== 0 ? 1 : (this.code & FLIP_DOWN_BIT) !== 0 ? -1 : 0;
    return this.out;
  }
}

/** Basic shape check for data read back from storage. */
export function isReplay(v: unknown): v is Replay {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<Replay>;
  return (
    typeof r.seed === 'string' &&
    typeof r.touch === 'boolean' &&
    (r.manual === undefined || typeof r.manual === 'boolean') &&
    typeof r.steps === 'number' &&
    typeof r.score === 'number' &&
    Array.isArray(r.changes) &&
    r.changes.length % 2 === 0 &&
    r.changes.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}
