import { GREY, OFF, pack, SOFT_GREY, WHITE, YELLOW } from './framebuffer';

/**
 * Every colour the world is drawn in, by what it is. `MONO` is the original white-on-black look and maps each role
 * to the colour that role always had, so the black and white game is pixel for pixel what it was. `COLOR` is the
 * daytime look: white snow, dark green pines, grey and brown rock, a grey track. The UI sits straight on the slope
 * with no cards behind it, so its words and frames take their colours from here too: white and yellow on the black
 * slope, dark ink and yellow on the white one, each with an edge that sets it off from the snow.
 */
export interface Palette {
  readonly color: boolean;
  /** The snow itself: what the frame is cleared to and what "erase" paints. */
  readonly snow: number;
  /** The sky above the start area's backdrop. */
  readonly sky: number;
  /** Little dashes of texture on the snow. */
  readonly fleck: number;
  /** The dithered cast shadow of anything standing up. */
  readonly shadow: number;
  /** The board's track, its shadow on the snow, and the softer shadow inside a side slip. */
  readonly track: number;
  readonly trackShadow: number;
  readonly trackSoft: number;
  /** Loose powder broken up across the groove's floor. Black and white keeps the line clean. */
  readonly trackGrain: number;
  /** Powder thrown out of hard turns, and spray in the air and on the snow. */
  readonly powder: number;
  readonly spray: number;
  readonly star: number;
  /** Deep snow: its humps. */
  readonly drift: number;
  /** The rider: body, board or skis, and the one pixel halo that keeps them readable on anything. */
  readonly riderBody: number;
  readonly riderBoard: number;
  readonly riderHalo: number;
  /** The yellow flash on whatever ended the run. */
  readonly hit: number;
  /**
   * UI words and frames and the edge drawn around them, and the highlighted ones (score, PLAY, the tutorial) with
   * theirs. Highlights are yellow in both looks: on the white snow a yellow word needs a dark edge to read, and at
   * the smallest size that edge fills the letters in, so there a highlight is `uiHotSmall` (dark ink) instead. With
   * `uiHotShadow` a highlighted word's edge is a drop shadow rather than an outline (see `drawTextShadow`).
   */
  readonly ui: number;
  readonly uiEdge: number;
  readonly uiHot: number;
  readonly uiHotEdge: number;
  readonly uiHotSmall: number;
  readonly uiHotShadow: boolean;
}

export const MONO: Palette = {
  color: false,
  snow: OFF,
  sky: OFF,
  fleck: WHITE,
  shadow: WHITE,
  track: WHITE,
  trackShadow: GREY,
  trackSoft: SOFT_GREY,
  trackGrain: WHITE,
  powder: WHITE,
  spray: WHITE,
  star: WHITE,
  drift: WHITE,
  riderBody: WHITE,
  riderBoard: WHITE,
  riderHalo: OFF,
  hit: YELLOW,
  ui: WHITE,
  uiEdge: OFF,
  uiHot: YELLOW,
  uiHotEdge: OFF,
  uiHotSmall: YELLOW,
  uiHotShadow: false,
};

/** Colour mode only: the named colours of the daytime slope. */
export const C = {
  snow: pack(0xf7, 0xf9, 0xfc),
  fleck: pack(0xdc, 0xe4, 0xee),
  shadow: pack(0xc3, 0xcf, 0xdd),
  // the track: a light groove pressed into the snow, with a cool blue shadow on its sunward wall
  track: pack(0xdc, 0xe4, 0xee),
  trackShadow: pack(0xa8, 0xbc, 0xd4),
  trackBand: pack(0xc4, 0xd2, 0xe2),
  powder: pack(0xc9, 0xd2, 0xdc),
  spray: pack(0xb3, 0xc0, 0xcf),
  star: pack(0xe8, 0xa3, 0x17),
  drift: pack(0xa9, 0xb9, 0xcc),
  // packed snow on a kicker, lit to shaded, and its orange marker poles
  snowLit: pack(0xfb, 0xfd, 0xff),
  snowMid: pack(0xe6, 0xee, 0xf6),
  snowShade: pack(0xc9, 0xd6, 0xe4),
  snowEdge: pack(0xa9, 0xbb, 0xcf),
  snowDeep: pack(0x8c, 0xa1, 0xba),
  pole: pack(0xe8, 0x6a, 0x10),
  poleTip: pack(0xa8, 0x4a, 0x0c),
  // cliff rock from the sunlit top of a rib down to the deepest gully, and the shadow below it
  rockHi: pack(0x9a, 0xa0, 0xa8),
  rockLit: pack(0x82, 0x88, 0x90),
  rockMid: pack(0x6c, 0x72, 0x7a),
  rockLow: pack(0x56, 0x5b, 0x62),
  rockDeep: pack(0x3e, 0x42, 0x48),
  shadowNear: pack(0xa9, 0xb7, 0xc8),
  shadowSoft: pack(0xc6, 0xd1, 0xde),
  chevron: pack(0xd9, 0x47, 0x2b),
  pine: pack(0x1e, 0x55, 0x30),
  pineShade: pack(0x13, 0x3d, 0x22),
  pineLight: pack(0x2e, 0x70, 0x40),
  bark: pack(0x6b, 0x43, 0x22),
  barkDark: pack(0x4a, 0x2e, 0x17),
  bush: pack(0x3e, 0x7a, 0x38),
  bushDark: pack(0x2a, 0x57, 0x26),
  rockGrey: pack(0x55, 0x59, 0x5f),
  rockGreyDark: pack(0x3a, 0x3d, 0x42),
  rockGreyLight: pack(0x74, 0x79, 0x80),
  rockBrown: pack(0x5c, 0x46, 0x33),
  rockBrownDark: pack(0x40, 0x30, 0x22),
  rockBrownLight: pack(0x7a, 0x61, 0x4a),
  white: pack(0xff, 0xff, 0xff),
  sky: pack(0x9f, 0xcd, 0xee),
  skyHigh: pack(0x7d, 0xb8, 0xe6),
  peak: pack(0xa9, 0xb8, 0xca),
  peakFar: pack(0xc2, 0xce, 0xdc),
  peakLine: pack(0x56, 0x68, 0x80),
  peakShade: pack(0x86, 0x97, 0xad),
  gate: pack(0xc8, 0x32, 0x2b),
  gateDark: pack(0x2a, 0x2e, 0x38),
  riderBody: pack(0xd8, 0x38, 0x3a),
  riderBoard: pack(0x2d, 0x5f, 0xa8),
  riderHalo: pack(0x1b, 0x1f, 0x2a),
  // the UI on the white slope: dark ink, and a warm red for what matters most
  ink: pack(0x1b, 0x22, 0x33),
} as const;

export const COLOR: Palette = {
  color: true,
  snow: C.snow,
  sky: C.skyHigh,
  fleck: C.fleck,
  shadow: C.shadow,
  track: C.track,
  trackShadow: C.trackShadow,
  trackSoft: C.trackBand,
  trackGrain: C.trackBand,
  powder: C.powder,
  spray: C.spray,
  star: C.star,
  drift: C.drift,
  riderBody: C.riderBody,
  riderBoard: C.riderBoard,
  riderHalo: C.riderHalo,
  hit: YELLOW,
  ui: C.ink,
  uiEdge: C.snow,
  uiHot: YELLOW,
  uiHotEdge: C.ink,
  uiHotSmall: C.ink,
  uiHotShadow: true,
};

/** The palette for a colour setting. */
export function paletteFor(color: boolean): Palette {
  return color ? COLOR : MONO;
}
