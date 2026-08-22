import { describe, expect, it } from 'vitest';
import {
  AirportValidationError,
  findRunway,
  findStar,
  loadTrainingWest,
  parseAirport,
  spawnSpecFor,
} from '../src/sim/scenario';

const valid = (): Record<string, unknown> => ({
  name: 'TEST FIELD',
  towerFreq: '118.1',
  runways: [{ id: '14', thr: [0, 0], course: 137, gsAngle: 3.0 }],
  fixes: { ALPHA: [-10, 0], BRAVO: [0, 10] },
  stars: [{ name: 'ALPHA 1A', route: ['ALPHA', 'BRAVO'], entryAlt: 8000 }],
  mva: [{ polygon: [[-20, -20], [20, -20], [20, 20], [-20, 20]], minAlt: 3000 }],
  windProfile: { surface: { dir: 140, kt: 8 }, fl100: { dir: 210, kt: 35 } },
  spawn: [{ t: 20, callsign: 'SWR34K', type: 'A320', star: 'ALPHA 1A' }],
});

function issuesOf(mutate: (raw: Record<string, unknown>) => void): string[] {
  const raw = valid();
  mutate(raw);
  try {
    parseAirport(raw);
  } catch (error) {
    if (error instanceof AirportValidationError) return error.issues;
    throw error;
  }
  throw new Error('expected the airport to be rejected');
}

describe('airport data (SPEC §13.2)', () => {
  it('loads the bundled training sector', () => {
    const airport = loadTrainingWest();
    expect(airport.name).toBe('TRAINING WEST');
    expect(airport.towerFreq).toBe('118.1');
    expect(findRunway(airport, '14')).toMatchObject({ course: 137, gsAngle: 3 });
    expect(findRunway(airport, '14')?.thr).toEqual({ x: 0, y: 0 });
    expect(airport.fixes['AMIKI']).toEqual({ x: -30, y: 2 });
    expect(Object.keys(airport.fixes)).toHaveLength(4);
    expect(airport.stars.map((s) => s.name)).toEqual(['AMIKI 1A', 'NOKRA 2B', 'RILAX 1C']);
    expect(airport.mva[1]?.polygon).toHaveLength(4);
    expect(airport.spawn).toHaveLength(6);
  });

  it('sorts the spawn schedule by time', () => {
    const airport = parseAirport({
      ...valid(),
      spawn: [
        { t: 300, callsign: 'BBB222', type: 'A320', star: 'ALPHA 1A' },
        { t: 100, callsign: 'AAA111', type: 'B738', star: 'ALPHA 1A' },
      ],
    });
    expect(airport.spawn.map((s) => s.callsign)).toEqual(['AAA111', 'BBB222']);
  });

  it('accepts the known-good file unchanged', () => {
    expect(() => parseAirport(valid())).not.toThrow();
  });
});

describe('airport validation (SPEC §13.2)', () => {
  it('rejects a STAR that routes via an unknown fix', () => {
    const issues = issuesOf((raw) => {
      raw['stars'] = [{ name: 'ALPHA 1A', route: ['ALPHA', 'NOWHERE'], entryAlt: 8000 }];
    });
    expect(issues).toContain('stars[0].route[1]: unknown fix "NOWHERE"');
  });

  it('rejects spawns with an unknown type or STAR', () => {
    expect(
      issuesOf((raw) => {
        raw['spawn'] = [{ t: 10, callsign: 'AAA111', type: 'C172', star: 'ALPHA 1A' }];
      }),
    ).toContain('spawn[0].type: unknown aircraft type "C172"');

    expect(
      issuesOf((raw) => {
        raw['spawn'] = [{ t: 10, callsign: 'AAA111', type: 'A320', star: 'ZULU 9Z' }];
      }),
    ).toContain('spawn[0].star: unknown STAR "ZULU 9Z"');
  });

  it('rejects a duplicate callsign in the schedule', () => {
    const issues = issuesOf((raw) => {
      raw['spawn'] = [
        { t: 10, callsign: 'AAA111', type: 'A320', star: 'ALPHA 1A' },
        { t: 90, callsign: 'AAA111', type: 'B738', star: 'ALPHA 1A' },
      ];
    });
    expect(issues).toContain('spawn: callsign "AAA111" is scheduled more than once');
  });

  it('rejects a degenerate MVA polygon', () => {
    const issues = issuesOf((raw) => {
      raw['mva'] = [{ polygon: [[0, 0], [1, 1]], minAlt: 3000 }];
    });
    expect(issues).toContain('mva[0].polygon: needs at least 3 points');
  });

  it('rejects a malformed tower frequency and a missing runway', () => {
    expect(issuesOf((raw) => { raw['towerFreq'] = 'tower'; })).toContain(
      'towerFreq: "tower" is not a frequency like "118.1"',
    );
    expect(issuesOf((raw) => { raw['runways'] = []; })).toContain(
      'runways: at least one runway is required',
    );
  });

  it('rejects out-of-range numbers', () => {
    expect(issuesOf((raw) => {
      raw['runways'] = [{ id: '14', thr: [0, 0], course: 400, gsAngle: 3 }];
    })).toContain('runways[0].course: 400 is above the maximum 360');

    expect(issuesOf((raw) => {
      raw['stars'] = [{ name: 'ALPHA 1A', route: ['ALPHA'], entryAlt: 50 }];
    })).toContain('stars[0].entryAlt: 50 is below the minimum 1000');
  });

  it('rejects a malformed coordinate', () => {
    expect(issuesOf((raw) => { raw['fixes'] = { ALPHA: [1] }; })).toContain(
      'fixes.ALPHA: expected [x, y] in NM',
    );
  });

  it('collects every problem in one pass instead of stopping at the first', () => {
    const issues = issuesOf((raw) => {
      raw['towerFreq'] = 'nope';
      raw['runways'] = [];
      raw['spawn'] = [{ t: 10, callsign: 'AAA111', type: 'C172', star: 'ZULU 9Z' }];
    });
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });

  it('reports a completely wrong shape without throwing something else', () => {
    expect(() => parseAirport(null)).toThrow(AirportValidationError);
    expect(() => parseAirport('nope')).toThrow(AirportValidationError);
    expect(() => parseAirport([])).toThrow(AirportValidationError);
  });
});

describe('spawn specs from the STAR (SPEC §7, §13.2)', () => {
  const airport = loadTrainingWest();

  it('puts the aircraft over the first fix at the entry altitude', () => {
    const spec = spawnSpecFor(airport, {
      t: 20,
      callsign: 'SWR34K',
      type: 'A320',
      star: 'AMIKI 1A',
    });

    expect(spec).toMatchObject({ callsign: 'SWR34K', type: 'A320', phase: 'STAR' });
    expect(spec?.pos).toEqual(airport.fixes['AMIKI']);
    expect(spec?.altitude).toBe(8000);
    // Pointed at OKTAV, the next fix on the route.
    expect(spec?.heading).toBeCloseTo(69.44, 1);
    expect(spec?.route).toEqual(['OKTAV']);
    // Below FL100, so the 250 kt restriction applies.
    expect(spec?.ias).toBe(250);
  });

  it('points a single-fix STAR at the threshold', () => {
    const spec = spawnSpecFor(airport, {
      t: 0,
      callsign: 'DLH4TA',
      type: 'B738',
      star: 'RILAX 1C',
    });
    expect(spec?.route).toEqual([]);
    // RILAX is at (26, 22); the threshold sits at the origin.
    expect(spec?.heading).toBeCloseTo(229.75, 1);
  });

  it('returns null for a STAR the airport does not have', () => {
    expect(spawnSpecFor(airport, { t: 0, callsign: 'X', type: 'A320', star: 'NOPE 1X' })).toBeNull();
    expect(findStar(airport, 'NOPE 1X')).toBeUndefined();
  });
});
