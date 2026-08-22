import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { loadTrainingWest, spawnAircraft } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import type { SimEvent, SimEventRecord } from '../src/sim/events';

/** Runs the sim and keeps every event with the sim time it happened at. */
function run(state: SimState, seconds: number): SimEventRecord[] {
  const log: SimEventRecord[] = [];
  for (let i = 0; i < seconds; i += 1) {
    tick(state);
    log.push(...drainEvents(state));
  }
  return log;
}

const kinds = (log: SimEventRecord[], kind: SimEvent['kind']): SimEventRecord[] =>
  log.filter((r) => r.event.kind === kind);

describe('spawn schedule (SPEC §13.2)', () => {
  it('checks traffic in at its scheduled time', () => {
    const state = createSimState({ seed: 5, airport: loadTrainingWest() });
    expect(state.pendingSpawns).toHaveLength(6);

    const before = run(state, 19);
    expect(state.aircraft).toHaveLength(0);
    expect(kinds(before, 'spawned')).toHaveLength(0);

    const atTwenty = run(state, 1);
    expect(state.time).toBe(20);
    expect(state.aircraft).toHaveLength(1);
    expect(kinds(atTwenty, 'spawned')[0]?.event).toEqual({
      kind: 'spawned',
      callsign: 'SWR34K',
      star: 'AMIKI 1A',
    });
    expect(state.pendingSpawns).toHaveLength(5);
  });

  it('runs the whole training-west schedule', () => {
    const state = createSimState({ seed: 5, airport: loadTrainingWest() });
    const log = run(state, 640);

    expect(kinds(log, 'spawned').map((r) => (r.event as { callsign: string }).callsign)).toEqual([
      'SWR34K',
      'DLH4TA',
      'EZS61B',
      'AUA904',
      'SWR17E',
      'GAC22',
    ]);
    expect(state.pendingSpawns).toHaveLength(0);
    expect(state.aircraft).toHaveLength(6);
    // Every arrival checked in and was told radar contact.
    expect(kinds(log, 'transmission').length).toBeGreaterThanOrEqual(12);
  });
});

describe('STAR navigation (SPEC §7)', () => {
  it('flies the fix sequence and then holds heading', () => {
    const state = createSimState({ seed: 5, airport: loadTrainingWest() });
    run(state, 20);

    const ac = state.aircraft[0]!;
    expect(ac.phase).toBe('STAR');
    expect(ac.route).toEqual(['OKTAV']);

    run(state, 30);
    expect(ac.target.directTo).toBe('OKTAV');
    expect(ac.heading).toBeCloseTo(69.44, 0);

    // AMIKI to OKTAV is 17 NM; at 275 kt ground speed that takes about 224 s.
    run(state, 260);
    expect(ac.route).toEqual([]);
    expect(ac.target.directTo).toBeUndefined();
    expect(ac.phase).toBe('STAR');
  });

  it('drops out of the STAR as soon as it is vectored', () => {
    const state = createSimState({ seed: 5, airport: loadTrainingWest() });
    run(state, 20);
    const ac = state.aircraft[0]!;

    dispatch(state, 'SWR34K', [{ kind: 'heading', deg: 180, turn: 'L' }]);
    run(state, 8);

    expect(ac.phase).toBe('VECTOR');
    expect(ac.target.directTo).toBeUndefined();
    expect(ac.target.heading).toEqual({ deg: 180, turn: 'L' });
    // The route is no longer followed, even though it is still on file.
    run(state, 60);
    expect(ac.target.directTo).toBeUndefined();
  });
});

describe('a provoked conflict (SPEC §8, DoD M2)', () => {
  function headOnPair(): SimState {
    const state = createSimState({ seed: 11 });
    // 30 NM apart, same level, closing head-on at 275 kt each.
    spawnAircraft(state, {
      callsign: 'AAA111',
      type: 'A320',
      pos: { x: -15, y: 0 },
      altitude: 5000,
      heading: 90,
      ias: 250,
    });
    spawnAircraft(state, {
      callsign: 'BBB222',
      type: 'A320',
      pos: { x: 15, y: 0 },
      altitude: 5000,
      heading: 270,
      ias: 250,
    });
    drainEvents(state);
    return state;
  }

  it('raises STCA first and the separation loss afterwards', () => {
    const state = headOnPair();
    const log = run(state, 240);

    const stca = kinds(log, 'stca');
    const loss = kinds(log, 'separationLoss');

    expect(stca.length).toBeGreaterThan(0);
    expect(loss).toHaveLength(1);
    expect(stca[0]!.at).toBeLessThan(loss[0]!.at);
    expect(loss[0]!.event).toEqual({ kind: 'separationLoss', a: 'AAA111', b: 'BBB222' });
    expect(stca[0]!.event).toEqual({ kind: 'stca', pairs: [['AAA111', 'BBB222']] });
  });

  it('warns only once the pair is inside the two-minute horizon', () => {
    const state = headOnPair();
    // At 30 NM and 550 kt closing speed the conflict is still ~3 minutes out.
    const early = run(state, 8);
    expect(kinds(early, 'stca')).toHaveLength(0);

    const later = run(state, 120);
    expect(kinds(later, 'stca').length).toBeGreaterThan(0);
  });

  it('marks both contacts on the radar picture', () => {
    const state = headOnPair();
    run(state, 180);

    const alerts = state.snapshot!.contacts.map((c) => c.alert);
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a === 'stca' || a === 'conflict')).toBe(true);
  });

  it('does not report the same pair again while it stays in conflict', () => {
    const state = createSimState({ seed: 11 });
    spawnAircraft(state, {
      callsign: 'AAA111', type: 'A320', pos: { x: 0, y: 0 },
      altitude: 5000, heading: 90, ias: 250,
    });
    spawnAircraft(state, {
      callsign: 'BBB222', type: 'A320', pos: { x: 1, y: 0 },
      altitude: 5000, heading: 90, ias: 250,
    });
    drainEvents(state);

    // Same heading and speed: they stay 1 NM apart for the whole run.
    const log = run(state, 300);
    expect(kinds(log, 'separationLoss')).toHaveLength(1);
    expect(state.activeConflicts).toEqual(['AAA111|BBB222']);
  });

  it('reports a pair again after separation has been restored', () => {
    const state = createSimState({ seed: 11 });
    const a = spawnAircraft(state, {
      callsign: 'AAA111', type: 'A320', pos: { x: 0, y: 0 },
      altitude: 5000, heading: 90, ias: 250,
    });
    spawnAircraft(state, {
      callsign: 'BBB222', type: 'A320', pos: { x: 1, y: 0 },
      altitude: 5000, heading: 90, ias: 250,
    });
    drainEvents(state);

    expect(kinds(run(state, 5), 'separationLoss')).toHaveLength(1);

    // Pull them apart vertically, then squeeze them together again.
    a.altitude = 9000;
    a.target.altitude = 9000;
    expect(kinds(run(state, 5), 'separationLoss')).toHaveLength(0);
    expect(state.activeConflicts).toEqual([]);

    a.altitude = 5000;
    a.target.altitude = 5000;
    expect(kinds(run(state, 5), 'separationLoss')).toHaveLength(1);
  });
});

describe('MVA monitoring (SPEC §8)', () => {
  it('reports a bust once per aircraft', () => {
    const state = createSimState({ seed: 3, airport: loadTrainingWest() });
    // Inside the 5000 ft sector of training-west, well below it.
    spawnAircraft(state, {
      callsign: 'AAA111',
      type: 'A320',
      pos: { x: 20, y: 20 },
      altitude: 4000,
      heading: 180,
      ias: 220,
    });
    drainEvents(state);

    const log = run(state, 60);
    const violations = kinds(log, 'mvaViolation');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.event).toEqual({ kind: 'mvaViolation', callsign: 'AAA111' });
  });

  it('stays quiet above the sector minimum', () => {
    const state = createSimState({ seed: 3, airport: loadTrainingWest() });
    spawnAircraft(state, {
      callsign: 'AAA111',
      type: 'A320',
      pos: { x: 20, y: 20 },
      altitude: 6000,
      heading: 180,
      ias: 220,
    });
    drainEvents(state);

    expect(kinds(run(state, 30), 'mvaViolation')).toHaveLength(0);
  });
});
