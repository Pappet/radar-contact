import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { PILOT_DELAY_MAX_S, PILOT_DELAY_MIN_S } from '../src/sim/constants';
import type { SimEventRecord } from '../src/sim/events';
import { spawnAircraft } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import { pilotDelaySeconds } from '../src/sim/pilot';

function setup(altitude = 8000): { state: SimState } {
  // Hearback errors are their own feature (M4) and get their own tests; the
  // rate 0 here keeps the pre-M4 readbacks deterministic.
  const state = createSimState({ seed: 42, hearbackErrorRate: 0 });
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

describe('hearback errors (SPEC §6, DoD M4)', () => {
  /** Setup with the hearback rate turned all the way up, so it always fires. */
  function eagerSetup(altitude = 8000): { state: SimState } {
    const state = createSimState({ seed: 42, hearbackErrorRate: 1 });
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

  const spokenHeading = (text: string): number => {
    const match = /heading (\d{3})/.exec(text);
    if (!match) throw new Error(`no heading in "${text}"`);
    return Number(match[1]);
  };
  const spokenAltitude = (text: string): number => {
    const match = /(\d+) feet/.exec(text);
    if (!match) throw new Error(`no altitude in "${text}"`);
    return Number(match[1]);
  };

  it('are off at rate 0', () => {
    const { state } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'heading', deg: 270, turn: 'L' }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual(['left heading 270, SWR34K']);
    expect(state.aircraft[0]!.target.heading).toEqual({ deg: 270, turn: 'L' });
  });

  it('deviate the heading by 10° in readback and execution', () => {
    const { state } = eagerSetup();
    dispatch(state, 'SWR34K', [{ kind: 'heading', deg: 270, turn: 'L' }]);
    // The ATC transmission itself stays verbatim — the error happens later.
    expect(transmissions(drainEvents(state))).toEqual(['SWR34K, turn left heading 270']);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    const readback = transmissions(drainEvents(state))[0]!;
    const heard = spokenHeading(readback);
    expect(heard === 260 || heard === 280).toBe(true);

    const ac = state.aircraft[0]!;
    expect(ac.target.heading?.turn).toBe('L');
    expect(ac.target.heading?.deg).toBe(heard);
    expect(ac.pilot.hearbackTaken).toEqual([{ kind: 'heading', deg: heard, turn: 'L' }]);
  });

  it('deviate the altitude by 1000 ft in readback and execution', () => {
    const { state } = eagerSetup();
    dispatch(state, 'SWR34K', [{ kind: 'altitude', ft: 5000 }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    const readback = transmissions(drainEvents(state))[0]!;
    const heard = spokenAltitude(readback);
    expect(heard === 4000 || heard === 6000).toBe(true);
    expect(state.aircraft[0]!.target.altitude).toBe(heard);
  });

  it('mishear exactly one value of a multi-value transmission', () => {
    const { state } = eagerSetup();
    dispatch(state, 'SWR34K', [
      { kind: 'heading', deg: 270, turn: 'L' },
      { kind: 'altitude', ft: 5000 },
    ]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    const ac = state.aircraft[0]!;
    const headingOff = ac.target.heading?.deg !== 270;
    const altitudeOff = ac.target.altitude !== 5000;
    expect(headingOff !== altitudeOff).toBe(true); // exactly one, never both

    // And the readback names the wrong value, not the cleared one.
    const readback = transmissions(drainEvents(state))[0]!;
    expect(readback).toContain(headingOff ? String(spokenHeading(readback)) : '270');
    expect(readback).toContain(
      altitudeOff ? String(spokenAltitude(readback)) : '5000 feet',
    );
  });

  it('cannot mishear a transmission without heading or altitude', () => {
    const { state } = eagerSetup();
    dispatch(state, 'SWR34K', [{ kind: 'speed', kt: 220 }]);
    drainEvents(state);
    for (let i = 0; i < PILOT_DELAY_MAX_S + 1; i += 1) tick(state);

    expect(transmissions(drainEvents(state))).toEqual(['speed 220 knots, SWR34K']);
    expect(state.aircraft[0]!.target.speed).toBe(220);
  });

  it('statistical sanity: rate 0.5 deviates about half of the clearances', () => {
    // Statistical sanity: at rate 0.5 roughly half of the clearances wobble.
    const state = createSimState({ seed: 9, hearbackErrorRate: 0.5 });
    spawnAircraft(state, {
      callsign: 'SWR34K',
      type: 'A320',
      pos: { x: -30, y: 2 },
      altitude: 8000,
      heading: 90,
      ias: 250,
    });
    drainEvents(state);

    let deviations = 0;
    const clearances = 60;
    for (let i = 0; i < clearances; i += 1) {
      dispatch(state, 'SWR34K', [{ kind: 'altitude', ft: 5000 }]);
      for (let t = 0; t < PILOT_DELAY_MAX_S + 1; t += 1) tick(state);
      transmissions(drainEvents(state));
      deviations += state.aircraft[0]!.target.altitude === 5000 ? 0 : 1;
    }
    // Far from both 0 and 60 — the rate really is a per-transmission chance.
    expect(deviations).toBeGreaterThan(15);
    expect(deviations).toBeLessThan(45);
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
