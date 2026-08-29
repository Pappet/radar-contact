import { describe, expect, it } from 'vitest';
import type { AircraftState } from '../src/sim/aircraft';
import { aircraftProfile } from '../src/sim/aircraft';
import {
  extrapolate,
  findConflicts,
  findStcaPairs,
  isConflict,
  isSeparationRelevant,
  mvaAt,
  pairKey,
  pointInPolygon,
  predictsConflict,
  violatesMva,
  wakeMinInTrailNm,
} from '../src/sim/separation';
import type { WakeCategory } from '../src/sim/aircraft';
import type { Phase } from '../src/sim/phases';
import type { Vec2 } from '../src/sim/geo';

interface TrafficOptions {
  altitude?: number;
  track?: number;
  gs?: number;
  vs?: number;
  phase?: Phase;
}

function traffic(callsign: string, pos: Vec2, options: TrafficOptions = {}): AircraftState {
  const profile = aircraftProfile('A320');
  return {
    id: callsign,
    callsign,
    type: 'A320',
    pos,
    altitude: options.altitude ?? 5000,
    heading: options.track ?? 90,
    track: options.track ?? 90,
    ias: 250,
    tas: 275,
    gs: options.gs ?? 0,
    vs: options.vs ?? 0,
    target: { altitude: options.altitude ?? 5000, speed: 250 },
    phase: options.phase ?? 'VECTOR',
    wake: profile.wake,
    squawk: '1000',
    onFrequency: true,
    pilot: { queue: [] },
    spawnedAt: 0,
    labelOffset: { x: 0, y: 0 },
    trail: [],
    route: [],
  };
}

describe('separation pair logic (SPEC §8)', () => {
  it('needs both minima breached at once', () => {
    const a = traffic('AAA111', { x: 0, y: 0 });
    // 2 NM apart, same level — that is a loss.
    expect(isConflict(a, traffic('BBB222', { x: 2, y: 0 }))).toBe(true);
    // 2 NM apart but 1000 ft apart — vertical minimum is met.
    expect(isConflict(a, traffic('BBB222', { x: 2, y: 0 }, { altitude: 6000 }))).toBe(false);
    // Same level but 3 NM apart — horizontal minimum is met exactly.
    expect(isConflict(a, traffic('BBB222', { x: 3, y: 0 }))).toBe(false);
    // Just inside both.
    expect(isConflict(a, traffic('BBB222', { x: 2.99, y: 0 }, { altitude: 5999 }))).toBe(true);
  });

  it('watches every pair only once and ignores the irrelevant ones', () => {
    const conflicts = findConflicts([
      traffic('AAA111', { x: 0, y: 0 }),
      traffic('BBB222', { x: 1, y: 0 }),
      traffic('CCC333', { x: 2, y: 0 }),
      // Above 15 000 ft: out of scope.
      traffic('DDD444', { x: 0.5, y: 0 }, { altitude: 16000 }),
      // Already handed off.
      traffic('EEE555', { x: 0.5, y: 0 }, { phase: 'DONE' }),
    ]);

    expect(conflicts).toHaveLength(3);
    const keys = conflicts.map((c) => pairKey(c.a, c.b));
    expect(new Set(keys).size).toBe(3);
    expect(keys).toContain('AAA111|BBB222');
    expect(keys).toContain('AAA111|CCC333');
    expect(keys).toContain('BBB222|CCC333');
  });

  it('keys a pair the same regardless of order', () => {
    expect(pairKey('BBB222', 'AAA111')).toBe(pairKey('AAA111', 'BBB222'));
  });

  it('drops aircraft that are out of scope', () => {
    expect(isSeparationRelevant(traffic('AAA111', { x: 0, y: 0 }))).toBe(true);
    expect(isSeparationRelevant(traffic('AAA111', { x: 0, y: 0 }, { altitude: 15000 }))).toBe(false);
    expect(isSeparationRelevant(traffic('AAA111', { x: 0, y: 0 }, { phase: 'DONE' }))).toBe(false);
  });
});

describe('STCA extrapolation (SPEC §8)', () => {
  it('projects position and altitude along the current track', () => {
    const ac = traffic('AAA111', { x: 0, y: 0 }, { track: 90, gs: 360, vs: -600 });
    const after = extrapolate(ac, 60);
    expect(after.pos.x).toBeCloseTo(6, 6);
    expect(after.pos.y).toBeCloseTo(0, 6);
    expect(after.altitude).toBeCloseTo(4400, 6);
  });

  it('warns about a head-on pair before they are actually close', () => {
    // 30 NM apart, closing at 720 kt: inside three minutes, outside two.
    const a = traffic('AAA111', { x: -15, y: 0 }, { track: 90, gs: 360 });
    const b = traffic('BBB222', { x: 15, y: 0 }, { track: 270, gs: 360 });

    expect(isConflict(a, b)).toBe(false);
    expect(predictsConflict(a, b, 180)).toBe(true);
    expect(predictsConflict(a, b, 120)).toBe(false); // still further out than the horizon
    expect(findStcaPairs([a, b])).toHaveLength(0);
  });

  it('warns once the conflict moves inside the lookahead', () => {
    const a = traffic('AAA111', { x: -8, y: 0 }, { track: 90, gs: 360 });
    const b = traffic('BBB222', { x: 8, y: 0 }, { track: 270, gs: 360 });
    expect(predictsConflict(a, b)).toBe(true);
    expect(findStcaPairs([a, b])).toEqual([{ a: 'AAA111', b: 'BBB222' }]);
  });

  it('stays quiet for tracks that never converge', () => {
    const a = traffic('AAA111', { x: -8, y: 0 }, { track: 270, gs: 360 });
    const b = traffic('BBB222', { x: 8, y: 0 }, { track: 90, gs: 360 });
    expect(predictsConflict(a, b)).toBe(false);
  });

  it('takes the vertical prediction into account', () => {
    // Converging horizontally but 2000 ft apart and holding level.
    const a = traffic('AAA111', { x: -8, y: 0 }, { track: 90, gs: 360, altitude: 5000 });
    const b = traffic('BBB222', { x: 8, y: 0 }, { track: 270, gs: 360, altitude: 7000 });
    expect(predictsConflict(a, b)).toBe(false);

    // The same pair, but one is descending into the other.
    const descending = traffic('BBB222', { x: 8, y: 0 }, {
      track: 270,
      gs: 360,
      altitude: 7000,
      vs: -1200,
    });
    expect(predictsConflict(a, descending)).toBe(true);
  });

  it('reports a pair that is already too close', () => {
    const a = traffic('AAA111', { x: 0, y: 0 }, { gs: 0 });
    const b = traffic('BBB222', { x: 1, y: 0 }, { gs: 0 });
    expect(predictsConflict(a, b)).toBe(true);
  });
});

describe('point in polygon (SPEC §8)', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('separates inside from outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 11, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 11 }, square)).toBe(false);
  });

  it('handles a concave shape', () => {
    const lShape: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 2 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false); // the notch
  });

  it('is false for a degenerate polygon', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [])).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe(false);
  });
});

describe('MVA (SPEC §8)', () => {
  const sectors = [
    { polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], minAlt: 3000 },
    { polygon: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }], minAlt: 5000 },
  ];

  it('takes the highest minimum where sectors overlap', () => {
    expect(mvaAt(sectors, { x: 5, y: 5 })).toBe(3000);
    expect(mvaAt(sectors, { x: 15, y: 15 })).toBe(5000);
    expect(mvaAt(sectors, { x: 30, y: 30 })).toBeNull();
  });

  it('allows a 100 ft buffer before it counts as a bust', () => {
    expect(violatesMva(traffic('AAA111', { x: 5, y: 5 }, { altitude: 3000 }), sectors)).toBe(false);
    expect(violatesMva(traffic('AAA111', { x: 5, y: 5 }, { altitude: 2900 }), sectors)).toBe(false);
    expect(violatesMva(traffic('AAA111', { x: 5, y: 5 }, { altitude: 2899 }), sectors)).toBe(true);
  });

  it('exempts aircraft established on the approach', () => {
    const low = { altitude: 1000 };
    expect(violatesMva(traffic('AAA111', { x: 5, y: 5 }, low), sectors)).toBe(true);
    expect(
      violatesMva(traffic('AAA111', { x: 5, y: 5 }, { ...low, phase: 'LOC' }), sectors),
    ).toBe(false);
    expect(
      violatesMva(traffic('AAA111', { x: 5, y: 5 }, { ...low, phase: 'GS' }), sectors),
    ).toBe(false);
  });

  it('ignores aircraft outside every sector', () => {
    expect(violatesMva(traffic('AAA111', { x: 99, y: 99 }, { altitude: 500 }), sectors)).toBe(false);
  });
});

describe('wake in-trail minima on the final (SPEC §8, DoD M4)', () => {
  const CATEGORIES: WakeCategory[] = ['L', 'M', 'H'];

  it('matches the matrix for every leader/follower combination', () => {
    // SPEC §8: behind H it is H 4 / M 5 / L 6; L behind M: 5; otherwise 3.
    const expected: Record<WakeCategory, Record<WakeCategory, number>> = {
      H: { H: 4, M: 5, L: 6 },
      M: { H: 3, M: 3, L: 5 },
      L: { H: 3, M: 3, L: 3 },
    };
    for (const leader of CATEGORIES) {
      for (const follower of CATEGORIES) {
        expect(wakeMinInTrailNm(leader, follower)).toBe(expected[leader][follower]);
      }
    }
  });

  it('keeps the plain radar minimum between equals', () => {
    expect(wakeMinInTrailNm('M', 'M')).toBe(3);
    expect(wakeMinInTrailNm('M', 'H')).toBe(3);
  });
});
