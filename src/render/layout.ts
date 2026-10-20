export interface Rect {
  w: number;
  h: number;
}

/**
 * The block at the top left that holds the score. It is drawn on solid black, and snow texture and
 * weather are kept out of it, so the numbers never fight with flecks.
 */
export function hudRect(big: boolean): Rect {
  return big ? { w: 92, h: 62 } : { w: 62, h: 34 };
}
