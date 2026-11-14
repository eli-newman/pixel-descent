/**
 * A dare: one finished run, packed into a share link so a friend can play the same course with its score to
 * beat. The game builds it, the link carries it (`/c/<code>`), the server draws its preview card from it and the game
 * reads it back when the link is opened. Pure: no DOM, no storage.
 *
 * The code is readable on purpose, `k3m9qa-1240-312-4-3-t`: course, score, metres, stars, tricks, then how the run
 * ended (and `s` on skis), then the rider's look as two digits (`-21`: board 2, rider 1) when it is not the plain one.
 * Codes from before looks were sent have no look and ride the plain one. The course seed is in it, as it always was in share links, but the player never sees it:
 * the game clears the address bar on load. Nothing is signed, so a hand-edited link can claim any score; there is no
 * way to stop that without accounts, and a dare between friends does not need one.
 */

/** How the run ended: hit a tree, a dead tree, a rock or a bush, or bailed a landing. */
export type DareEnd = 'tree' | 'dead' | 'rock' | 'bush' | 'bail';

export interface Dare {
  /** The course. Never drawn or written out to the player. */
  seed: string;
  score: number;
  dist: number;
  stars: number;
  tricks: number;
  end: DareEnd;
  skis: boolean;
  /** The look the rider wore, as indexes into `BOARDS` and `RIDERS` (`state/progress.ts`): 0 is the plain one. */
  board: number;
  rider: number;
}

const END_CODE: Record<DareEnd, string> = {
  tree: 't',
  dead: 'd',
  rock: 'r',
  bush: 'u',
  bail: 'l',
};

const CODE =
  /^([a-z0-9]{1,12})-(\d{1,7})-(\d{1,6})-(\d{1,5})-(\d{1,5})-([tdrul])(s?)(?:-(\d)(\d))?$/;

/** Largest numbers a code may carry, so a broken or hostile link cannot ask the card for absurd values. */
const MAX = { score: 9_999_999, dist: 999_999, count: 99_999, look: 9 } as const;

function clamp(v: number, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)));
}

/** The link code for a dare. */
export function encodeDare(c: Readonly<Dare>): string {
  const board = clamp(c.board, MAX.look);
  const rider = clamp(c.rider, MAX.look);
  // The plain look adds nothing, so its codes are the same as before looks were sent.
  const look = board === 0 && rider === 0 ? [] : [`${board}${rider}`];
  return [
    c.seed,
    clamp(c.score, MAX.score),
    clamp(c.dist, MAX.dist),
    clamp(c.stars, MAX.count),
    clamp(c.tricks, MAX.count),
    END_CODE[c.end] + (c.skis ? 's' : ''),
    ...look,
  ].join('-');
}

/** The dare in a link code, or null when the code is not one. */
export function decodeDare(code: string | null | undefined): Dare | null {
  const m = CODE.exec(code ?? '');
  if (!m) return null;
  const end = (Object.keys(END_CODE) as DareEnd[]).find((k) => END_CODE[k] === m[6]);
  if (!end) return null;
  return {
    seed: m[1] ?? '',
    score: Number(m[2]),
    dist: Number(m[3]),
    stars: Number(m[4]),
    tricks: Number(m[5]),
    end,
    skis: m[7] === 's',
    board: Number(m[8] ?? 0),
    rider: Number(m[9] ?? 0),
  };
}

/** The path a dare is shared at, `/c/<code>`. */
export function darePath(c: Readonly<Dare>): string {
  return `/c/${encodeDare(c)}`;
}

/**
 * The code in a dare path (`/c/<code>`, with or without a trailing slash, under any folder the game is hosted in), or
 * null.
 */
export function codeFromPath(pathname: string): string | null {
  const m = /\/c\/([^/]+)\/?$/.exec(pathname);
  return m?.[1] ?? null;
}
