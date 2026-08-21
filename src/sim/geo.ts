/**
 * Pure 2D geometry on the NM grid (SPEC §4).
 * x = east, y = north, bearings in degrees true, clockwise from north.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/** Wraps any angle into [0, 360). */
export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Signed shortest angular difference from → to, in (-180, 180]. */
export function angleDiff(from: number, to: number): number {
  const diff = normalizeDeg(to - from);
  return diff > 180 ? diff - 360 : diff;
}

export const add = (a: Vec2, b: Vec2): Vec2 => vec2(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => vec2(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, f: number): Vec2 => vec2(a.x * f, a.y * f);

/** Turns a bearing and a magnitude into a vector on the NM grid. */
export function polarToVec(bearingDeg: number, magnitude: number): Vec2 {
  const rad = toRadians(bearingDeg);
  return vec2(magnitude * Math.sin(rad), magnitude * Math.cos(rad));
}

/** Inverse of polarToVec; the bearing of a zero vector is reported as 0. */
export function vecToPolar(v: Vec2): { bearing: number; magnitude: number } {
  return {
    bearing: normalizeDeg(toDegrees(Math.atan2(v.x, v.y))),
    magnitude: Math.hypot(v.x, v.y),
  };
}

export function distanceNm(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Bearing from a to b, degrees true. */
export function bearingTo(a: Vec2, b: Vec2): number {
  return normalizeDeg(toDegrees(Math.atan2(b.x - a.x, b.y - a.y)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
