import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { PILOT_DELAY_MAX_S, PILOT_DELAY_MIN_S } from '../src/sim/constants';
import type { SimEventRecord } from '../src/sim/events';
import { spawnAircraft } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import { pilotDelaySeconds } from '../src/sim/pilot';

function setup(altitude = 8000): { state: SimState } {
  const state = createSimState({ seed: 42 });
  spawnAircraft(state, {
    callsign: 'SWR34K',
    type: 'A320',
    pos: { x: -30, y: 2 },
    altitude,
    heading: 90,
    ias: 250,
    star: 'AMIKI 1A',
  });
  drainEvents(state);
  return { state };
}

const transmissions = (records: SimEventRecord[]): string[] =>
  records.flatMap((r) => (r.event.kind === 'transmission' ? [r.event.text] : []));

describe('pilot reaction delay (SPEC §6)', () => {
  it('stays inside [2, 6] seconds and varies with the seed', () => {
    const state = createSimState({ seed: 7 });
    const draws = Array.from({ length: 500 }, () => pilotDelaySeconds(state));
    for (const delay of draws) {
      expect(delay).toBeGreaterThanOrEqual(PILOT_DELAY_MIN_S);
      expect(delay).toBeLessThanOrEqual(PILOT_DELAY_MAX_S);
    }
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(3.0);
    expect(mean).toBeLessThan(4.0);
    expect(new Set(draws).size).toBeGreaterThan(50);
  });
});

describe('clearance → readback → execution', () => {
  it('transmits at once but only acts after the delay', () => {
    const { state } = setup();
    const ac = state.aircraft[0]!;

    dispatch(state, 'SWR34K', [{ kind: 'heading', deg: 270, turn: 'L' }]);
    expect(transmissions(drainEvents(state))).toEqual(['SWR34K, turn left heading 270']);
    expect(ac.target.heading?.deg).toBe(90);

    tick(state); // 1 s — still before the earliest possible reaction
    expect(transmissions(drainEvents(state))).toEqual([]);
    expect(ac.target.heading?.deg).toBe(90);

    for (let i = 0; i < PILOT_DELAY_MAX_S; i += 1) tick(state);
    expect(transmissions(drainEvents(state))).toEqual(['left heading 270, SWR34K']);
    expect(ac.target.heading).toEqual({ deg: 270, turn: 'L' });
    expect(ac.heading).toBeLessThan(90); // already turning the long way round
  });

  it('reads back several clearances in one transmission', () => {
    const { state } = setup();
    dispatch(state, 'SWR34K', [
      { kind: 'heading', deg: 270, turn: 'L' },
      { kind: 'altitude', ft: 5000 },
      { kind: 'speed', kt: 220 },
    ]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual([
      'left heading 270, descend 5000 feet, speed 220 knots, SWR34K',
    ]);
    const ac = state.aircraft[0]!;
    expect(ac.target.altitude).toBe(5000);
    expect(ac.target.speed).toBe(220);
  });

  it('ignores a callsign that is not on frequency', () => {
    const { state } = setup();
    expect(dispatch(state, 'DLH4TA', [{ kind: 'altitude', ft: 5000 }])).toEqual({
      ok: false,
      reason: 'unknown-callsign',
    });
    expect(drainEvents(state)).toEqual([]);
  });
});

describe('refusals (SPEC §5)', () => {
  it('refuses more than 250 kt below 10 000 ft', () => {
    const { state } = setup(8000);
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 300 }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual(['unable, speed restriction, SWR34K']);
    expect(state.aircraft[0]!.target.speed).toBe(250);
  });

  it('accepts the same speed above 10 000 ft', () => {
    const { state } = setup(12000);
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 300 }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual(['speed 300 knots, SWR34K']);
    expect(state.aircraft[0]!.target.speed).toBe(300);
  });

  it('refuses speeds outside the type envelope', () => {
    const { state } = setup(8000);
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 120 }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual(['unable, aircraft performance, SWR34K']);
  });

  it('still carries out the acceptable part of a transmission', () => {
    const { state } = setup(8000);
    dispatch(state, 'SWR34K', [
      { kind: 'altitude', ft: 5000 },
      { kind: 'speed', kt: 300 },
    ]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual([
      'descend 5000 feet, SWR34K',
      'unable, speed restriction, SWR34K',
    ]);
    expect(state.aircraft[0]!.target.altitude).toBe(5000);
  });

  it('resumes a normal speed that respects the 250 kt restriction', () => {
    const { state } = setup(8000);
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 180 }]);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 'normal' }]);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);
    drainEvents(state);

    expect(state.aircraft[0]!.target.speed).toBe(250);
  });
});

describe('check-in (SPEC §10)', () => {
  it('calls in on the STAR and is told radar contact', () => {
    const state = createSimState({ seed: 3 });
    spawnAircraft(state, {
      callsign: 'SWR34K',
      type: 'A320',
      pos: { x: -30, y: 2 },
      altitude: 9000,
      heading: 90,
      ias: 250,
      targetAltitude: 8000,
      star: 'AMIKI 1A',
    });

    const records = drainEvents(state);
    expect(records[0]?.event).toEqual({ kind: 'spawned', callsign: 'SWR34K', star: 'AMIKI 1A' });
    expect(transmissions(records)).toEqual([
      'Approach, SWR34K, AMIKI 1A arrival, descending 8000 feet',
      'SWR34K, radar contact',
    ]);
  });
});
