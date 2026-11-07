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
  /** +1 the board points right, -1 left. Riding regular, right is heel side (back to camera) and left toe side (chest to camera). */
  face: 1 | -1;
  /** 1 regular, -1 switch: the rider faces the other way on the board, so heel and toe side swap looks. */
  stance: 1 | -1;
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
  /** Holding the board in the air: knees pulled up and a hand on the board (or a ski). */
  grab: boolean;
}

/**
 * True when the rider shows his back to the camera, on his heels: the board pointing right riding
 * regular, or left riding switch. Otherwise he is on his toes, chest to the camera.
 */
export function heelSide(pose: Readonly<RiderPose>): boolean {
  return pose.face > 0 === (pose.stance === 1);
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
    // up the slope for a moment) as it goes. The stance is the one he took off in all the way
    // round: after a half turn the landing swaps it, and the swapped pose faces the same way.
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
      stance: r.stance,
      tuck: 0,
      pitch: r.pitch,
      grab: r.grab,
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
    stance: r.stance,
    tuck,
    pitch: r.air ? r.pitch : 0,
    grab: r.air && r.grab,
  };
}
