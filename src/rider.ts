import { EDGE, START_X, START_Y, W } from './config';
import type { RiderPose } from './render/riderSprite';

export type Face = 1 | -1;

/** Largest sideways share of the heading (0 is straight downhill, 1 is straight sideways). */
export const MAX_HX = 0.86;
const STIFFNESS = 85;
const DAMPING = 13;
const ACCEL = 70;

export interface RiderState {
  /** Board tail position in world space. */
  x: number;
  y: number;
  /** Sideways component of the unit heading vector, eased towards the steering target. */
  hx: number;
  /** Rate of change of hx, which gives the carve its weight. */
  hv: number;
  /** Speed along the heading in px/s. */
  speed: number;
  face: Face;
  steep: boolean;
}

export function createRider(): RiderState {
  return { x: START_X, y: START_Y, hx: 0, hv: 0, speed: 0, face: -1, steep: true };
}

/** Cruising speed in px/s at a distance in metres. Ramps up gradually towards a cap. */
export function targetSpeed(distM: number): number {
  return 75 + 125 * (1 - Math.exp(-distM / 900));
}

/** Downhill share of the unit heading vector. */
export function headingY(hx: number): number {
  return Math.sqrt(Math.max(0, 1 - hx * hx));
}

export function headingAngle(hx: number): number {
  return (Math.atan2(headingY(hx), Math.abs(hx)) * 180) / Math.PI;
}

/**
 * Advance the rider by dt. The steering input in [-1, 1] sets a target heading; a damped spring
 * moves the real heading towards it, so the board eases from toe side to heel side.
 */
export function stepRider(r: RiderState, steer: number, dt: number, cruise: number): void {
  const goal = Math.max(-1, Math.min(1, steer)) * MAX_HX;
  r.hv += (goal - r.hx) * STIFFNESS * dt;
  r.hv *= Math.exp(-DAMPING * dt);
  r.hx = Math.max(-0.95, Math.min(0.95, r.hx + r.hv * dt));

  r.speed = r.speed < cruise ? Math.min(cruise, r.speed + ACCEL * dt) : r.speed;

  r.x += r.hx * r.speed * dt;
  r.y += headingY(r.hx) * r.speed * dt;

  // The slope has soft walls: pinned against one, the rider is turned away and loses speed.
  if (r.x < EDGE || r.x > W - EDGE) {
    r.x = r.x < EDGE ? EDGE : W - EDGE;
    r.hx *= 0.5;
    r.hv = 0;
    r.speed *= Math.exp(-2 * dt);
  }

  // Same hysteresis as the source art: no flicker between solid and outlined board or stances.
  const ang = headingAngle(r.hx);
  if (ang > 74) r.steep = true;
  else if (ang < 66) r.steep = false;
  if (r.hx > 0.05) r.face = 1;
  else if (r.hx < -0.05) r.face = -1;
}

/** Everything the renderer needs to draw the rider at a screen position. */
export function poseOf(r: RiderState, screenX: number, screenY: number): RiderPose {
  const ang = headingAngle(r.hx);
  const a = (ang * Math.PI) / 180;
  return {
    x: screenX,
    y: screenY,
    nx: r.face * Math.cos(a),
    ny: Math.sin(a),
    face: r.face,
    up: Math.min(1, Math.abs(r.hx) * 2.2),
    ang,
    steep: r.steep,
  };
}
