import { START_Y } from './config';
import { cruiseSpeed } from './rider';

/** The wall starts this far above the rider, which is well off the top of the screen. */
export const AV_START_GAP = 270;
/** Furthest behind the wall is allowed to fall; beyond this it speeds up to keep the pressure on. */
export const AV_MAX_GAP = 430;
/** The rider is buried when the wall front gets this close to the rider's head. */
const BURY_DY = 10;

export interface Avalanche {
  /** World y of the wall's lower edge. Everything above it is white. */
  y: number;
  /** Current speed in px/s. */
  speed: number;
  /** Smallest gap (px) to the rider so far this run. */
  minGap: number;
}

export function createAvalanche(riderY: number = START_Y): Avalanche {
  return { y: riderY - AV_START_GAP, speed: 0, minGap: AV_START_GAP };
}

/**
 * How fast the wall comes down as a share of cruising speed. Early on it is slower than the rider
 * can easily manage, so it only matters after a mistake. Around 1000 m it matches a rider who weaves
 * and never tucks, and past 2000 m it is as quick as cruising speed, so a rider who never tucks loses ground.
 */
export function avalancheRatio(distM: number): number {
  return 0.68 + 0.5 * (1 - Math.exp(-distM / 2000));
}

/**
 * Advance the wall. It runs at a share of cruising speed, surges when the rider is slower than
 * cruising speed (bushes, drifts, hard carving), and catches up if it has fallen far behind.
 * `ease` below 1 slows it down (used for touch controls, which steer less precisely).
 */
export function stepAvalanche(
  av: Avalanche,
  riderY: number,
  riderSpeed: number,
  distM: number,
  dt: number,
  ease = 1,
): void {
  const cruise = cruiseSpeed(distM);
  const surge = 0.5 * Math.max(0, cruise - riderSpeed);
  let v = (avalancheRatio(distM) * cruise + surge) * ease;
  const gap = riderY - av.y;
  if (gap > AV_MAX_GAP) v *= 1 + (gap - AV_MAX_GAP) / 150;
  av.speed = v;
  av.y += v * dt;
  av.minGap = Math.min(av.minGap, riderY - av.y);
}

export function isBuried(av: Avalanche, riderY: number): boolean {
  return av.y >= riderY - BURY_DY;
}

/** 0 when the wall is far away, 1 when it is about to bury the rider. Drives the rumble and the warning. */
export function avalancheDanger(av: Avalanche, riderY: number): number {
  const gap = riderY - av.y;
  return Math.max(0, Math.min(1, 1 - (gap - 30) / 190));
}
