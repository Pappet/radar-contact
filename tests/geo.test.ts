import { describe, expect, it } from 'vitest';
import { angleDiff, bearingTo, distanceNm, normalizeDeg, polarToVec, vecToPolar } from '../src/sim/geo';

describe('angles', () => {
  it('normalizes into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(725)).toBe(5);
  });

  it('reports the signed shortest difference', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(0, 181)).toBe(-179);
  });
});

describe('bearings on the NM grid', () => {
  it('uses y = north and x = east', () => {
    expect(bearingTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0, 6);
    expect(bearingTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 6);
    expect(bearingTo({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(180, 6);
    expect(bearingTo({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(270, 6);
  });

  it('round-trips polar and cartesian', () => {
    const v = polarToVec(137, 12);
    const polar = vecToPolar(v);
    expect(polar.bearing).toBeCloseTo(137, 6);
    expect(polar.magnitude).toBeCloseTo(12, 6);
    expect(distanceNm({ x: 0, y: 0 }, v)).toBeCloseTo(12, 6);
  });
});
