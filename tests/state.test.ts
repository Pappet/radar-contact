import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { SNAPSHOT_INTERVAL_S, TRAIL_LENGTH } from '../src/sim/constants';
import { spawnAircraft, TRAINING_WEST } from '../src/sim/scenario';
import {
  createSimState,
  drainEvents,
  setLabelOffset,
  tick,
  type SimState,
} from '../src/sim/state';

function withOneArrival(seed = 1): SimState {
  const state = createSimState({ seed, fixes: TRAINING_WEST.fixes });
  spawnAircraft(state, {
    callsign: 'SWR34K',
    type: 'A320',
    pos: { x: -30, y: 2 },
    altitude: 8000,
    heading: 90,
    ias: 250,
    star: 'AMIKI 1A',
  });
  drainEvents(state);
  return state;
}

describe('snapshot pipeline (SPEC §3)', () => {
  it('freezes a picture every four sim seconds', () => {
    const state = withOneArrival();
    expect(state.snapshot).toBeNull();

    for (let i = 0; i < SNAPSHOT_INTERVAL_S - 1; i += 1) tick(state);
    expect(state.snapshot).toBeNull();

    tick(state);
    expect(state.snapshot?.time).toBe(4);
    expect(state.snapshot?.contacts).toHaveLength(1);

    for (let i = 0; i < SNAPSHOT_INTERVAL_S; i += 1) tick(state);
    expect(state.snapshot?.time).toBe(8);
  });

  it('keeps the picture still between sweeps while the aircraft moves on', () => {
    const state = withOneArrival();
    for (let i = 0; i < SNAPSHOT_INTERVAL_S; i += 1) tick(state);
    const frozen = state.snapshot?.contacts[0]?.pos.x;

    tick(state);
    tick(state);
    expect(state.snapshot?.contacts[0]?.pos.x).toBe(frozen);
    expect(state.aircraft[0]!.pos.x).toBeGreaterThan(frozen!);
  });

  it('carries at most six trail positions', () => {
    const state = withOneArrival();
    for (let i = 0; i < SNAPSHOT_INTERVAL_S * 10; i += 1) tick(state);
    const trail = state.snapshot?.contacts[0]?.trail ?? [];
    expect(trail).toHaveLength(TRAIL_LENGTH);
    // Oldest first: the aircraft is heading east, so x grows along the trail.
    expect(trail[0]!.x).toBeLessThan(trail[TRAIL_LENGTH - 1]!.x);
  });

  it('takes a dragged label offset straight into the current snapshot', () => {
    const state = withOneArrival();
    for (let i = 0; i < SNAPSHOT_INTERVAL_S; i += 1) tick(state);
    const id = state.aircraft[0]!.id;

    setLabelOffset(state, id, { x: -60, y: 12 });
    expect(state.aircraft[0]!.labelOffset).toEqual({ x: -60, y: 12 });
    expect(state.snapshot?.contacts[0]?.labelOffset).toEqual({ x: -60, y: 12 });
  });

  it('reports the data the radar needs', () => {
    const state = withOneArrival();
    for (let i = 0; i < SNAPSHOT_INTERVAL_S; i += 1) tick(state);
    const contact = state.snapshot!.contacts[0]!;
    expect(contact).toMatchObject({
      callsign: 'SWR34K',
      type: 'A320',
      wake: 'M',
      phase: 'VECTOR',
      targetAltitude: 8000,
    });
    expect(contact.gs).toBeCloseTo(290, 0);
  });
});

describe('determinism (SPEC §3)', () => {
  it('replays identically for the same seed and command history', () => {
    const run = (seed: number): string => {
      const state = withOneArrival(seed);
      dispatch(state, 'SWR34K', [
        { kind: 'heading', deg: 100, turn: 'R' },
        { kind: 'altitude', ft: 4000 },
      ]);
      const log: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        tick(state);
        for (const record of drainEvents(state)) {
          if (record.event.kind === 'transmission') log.push(`${record.at}|${record.event.text}`);
        }
      }
      const ac = state.aircraft[0]!;
      log.push(`${ac.pos.x.toFixed(6)}|${ac.pos.y.toFixed(6)}|${ac.altitude.toFixed(3)}`);
      return log.join('\n');
    };

    expect(run(1234)).toBe(run(1234));
    expect(run(1234)).not.toBe(run(4321));
  });
});

describe('vectoring an arrival end to end', () => {
  it('turns, descends and slows down as cleared', () => {
    const state = withOneArrival();
    dispatch(state, 'SWR34K', [
      { kind: 'heading', deg: 180, turn: 'R' },
      { kind: 'altitude', ft: 4000 },
      { kind: 'speed', kt: 200 },
    ]);

    for (let i = 0; i < 300; i += 1) tick(state);
    const ac = state.aircraft[0]!;

    expect(ac.heading).toBeCloseTo(180, 6);
    expect(ac.altitude).toBe(4000);
    expect(ac.ias).toBe(200);
    expect(ac.vs).toBe(0);
    // Southbound at the end of the run.
    expect(ac.pos.y).toBeLessThan(2);
  });
});

describe('airport data (SPEC §13.2)', () => {
  it('loads the training sector', () => {
    expect(TRAINING_WEST.name).toBe('TRAINING WEST');
    expect(TRAINING_WEST.runways[0]).toMatchObject({ id: '14', course: 137, gsAngle: 3 });
    expect(TRAINING_WEST.runways[0]?.thr).toEqual({ x: 0, y: 0 });
    expect(TRAINING_WEST.fixes['AMIKI']).toEqual({ x: -30, y: 2 });
    expect(Object.keys(TRAINING_WEST.fixes)).toHaveLength(4);
    expect(TRAINING_WEST.stars.map((s) => s.name)).toEqual(['AMIKI 1A', 'NOKRA 2B', 'RILAX 1C']);
    expect(TRAINING_WEST.mva[1]?.polygon).toHaveLength(4);
    expect(TRAINING_WEST.spawn).toHaveLength(6);
  });
});
