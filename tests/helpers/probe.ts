import { pack } from '../../src/render/framebuffer';
import { MONO, type Palette } from '../../src/render/palette';

/** The powder colour in `PROBE`: a colour the game never uses. */
export const POWDER = pack(0x80, 0x40, 0x20);

/** Black and white, except the powder gets a colour of its own, so a track test can tell the line from the snow beside it. */
export const PROBE: Palette = { ...MONO, powder: POWDER };
