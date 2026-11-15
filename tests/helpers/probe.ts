import { pack } from '../../src/render/framebuffer';

/**
 * A powder colour the game never uses. A `TrackPainter` built with it draws its powder in it, so a track test can tell
 * the line from the snow beside it.
 */
export const POWDER = pack(0x80, 0x40, 0x20);
