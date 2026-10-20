import { SAVE_KEY } from './config';

/** Best score from localStorage. Storage can throw or be unavailable, so it is always wrapped. */
export function loadBest(): number {
  try {
    const n = Number(localStorage.getItem(SAVE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(SAVE_KEY, String(Math.floor(score)));
  } catch {
    // Private mode or blocked storage: the best score simply lasts for this session.
  }
}
