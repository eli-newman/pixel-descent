import { BOARD_LEN } from '../core/config';
import { headingAngle } from './rider';
import type { RiderState } from './riderState';
import { spinAngle } from './tricks';

/** Half the drawn board length in px (the spin pivots here). */
const SPIN_HALF_BOARD = BOARD_LEN / 2;

/** Everything the renderer needs to draw the rider at a screen position. */
export interface RiderPose {
  /** Board tail (the track head) in screen pixels. */
  x: number;
  y: number;
  /** Unit vector along the board, pointing downhill. */
  nx: number;
  ny: number;
  /** +1 heading right (heel side, back to camera), -1 heading left (toe side, chest to camera). */
  face: 1 | -1;
  /** 0 on the flats .. 1 fully upright, derived from how sideways the rider points. */
  up: number;
  /** Heading angle in degrees, 90 is straight downhill. */
  ang: number;
  /** Straight-downhill boards are drawn as an outline. */
  steep: boolean;
  /** 0..1: how deep the rider is in the straight-line speed tuck. */
  tuck: number;
  /** Flip angle in degrees (positive is a backflip, 0 or a multiple of 360 is upright). */
  pitch: number;
}

export function poseOf(
  r: Readonly<RiderState>,
  screenX: number,
  screenY: number,
  tuck: number,
): RiderPose {
  const ang0 = headingAngle(r.hx);
  const a = (ang0 * Math.PI) / 180;
  if (r.air && r.spin > 0) {
    // A spin turns the rider about the middle of the board: the board swings round through all
    // four directions, so he shows his chest, then his side, then his back (and the board points
    // up the slope for a moment) as it goes.
    // Screen y points down, so a positive angle would swing the nose to the left; negate it so holding right swings it right.
    const phi = (-spinAngle(r) * Math.PI) / 180;
    const bx = r.face * Math.cos(a);
    const by = Math.sin(a);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const nx = bx * c - by * sn;
    const ny = bx * sn + by * c;
    // The tail is placed so the middle of the board stays where the unspun rider's would be.
    const half = SPIN_HALF_BOARD;
    const mx = screenX + bx * half;
    const my = screenY + by * half;
    const pang = (Math.atan2(Math.abs(ny), Math.abs(nx)) * 180) / Math.PI;
    return {
      x: mx - nx * half,
      y: my - ny * half,
      nx,
      ny,
      face: nx >= 0 ? 1 : -1,
      up: Math.min(1, Math.abs(nx) * 2.2),
      ang: pang,
      steep: pang > 70,
      tuck: 0,
      pitch: r.pitch,
    };
  }
  return {
    x: screenX,
    y: screenY,
    nx: r.face * Math.cos(a),
    ny: Math.sin(a),
    face: r.face,
    up: Math.min(1, Math.abs(r.hx) * 2.2),
    ang: ang0,
    steep: r.steep,
    tuck,
    pitch: r.air ? r.pitch : 0,
  };
}
