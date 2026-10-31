const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;

/**
 * e^x using only + - * and /, whose results IEEE 754 fixes exactly. The language leaves Math.exp to
 * each engine, and a course must come out the same in every browser, so course generation uses this.
 */
export function detExp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  // x = k ln2 + r with |r| <= ln2 / 2, then a Taylor series for e^r.
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let term = 1;
  for (let n = 14; n >= 1; n--) term = 1 + (term * r) / n;
  // Scaling by a power of two is exact, apart from the rounding into subnormals IEEE also fixes.
  const step = k < 0 ? 0.5 : 2;
  for (let i = Math.abs(k); i > 0; i--) term *= step;
  return term;
}
