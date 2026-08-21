/**
 * Seeded RNG (SPEC §3): Mulberry32. The generator state travels inside the
 * SimState, so the same seed plus the same command history replays exactly.
 * Re-exported from state.ts, which is the module the rest of the sim uses.
 */

export interface RngHolder {
  rngState: number;
}

export function mulberry32(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) | 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform in [0, 1). */
export const nextRandom = mulberry32;

/** Uniform integer in [min, max]. */
export function randomInt(holder: RngHolder, min: number, max: number): number {
  return min + Math.floor(nextRandom(holder) * (max - min + 1));
}

/** Box–Muller normal deviate. */
export function randomNormal(holder: RngHolder, mean: number, sd: number): number {
  const u = Math.max(nextRandom(holder), Number.EPSILON);
  const v = nextRandom(holder);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
