import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { PILOT_DELAY_MAX_S } from '../src/sim/constants';
import type { AircraftState } from '../src/sim/aircraft';
import { distanceNm } from '../src/sim/geo';
import { loadTrainingWest, spawnAircraft } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import type { SimEventRecord } from '../src/sim/events';

const airport = loadTrainingWest();
const AMIKI = airport.fixes['AMIKI']!;

/** An arrival 15 NM west of AMIKI, lined up to cross it eastbound. */
function arrival(state: SimState): AircraftState {
  return spawnAircraft(state, {
    callsign: 'SWR34K',
    type: 'A320',
    pos: { x: AMIKI.x - 15, y: AMIKI.y },
    altitude: 8000,
    heading: 90,
    ias: 250,
  });
}

function setup(wind = false): { state: SimState; ac: AircraftState } {
  const state = createSimState({
    seed: 5,
    airport,
    ...(wind ? { wind: airport.windProfile } : {}),
    hearbackErrorRate: 0,
  });
  const ac = arrival(state);
  drainEvents(state);
  return { state, ac };
}

const transmissions = (log: SimEventRecord[]): string[] =>
  log.flatMap((r) => (r.event.kind === 'transmission' ? [r.event.text] : []));

function run(state: SimState, seconds: number): void {
  for (let i = 0; i < seconds; i += 1) tick(state);
}

describe('holding at a fix (SPEC §4, §14 M4)', () => {
  it('is spoken as published and enters via the fix', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    expect(transmissions(drainEvents(state))).toEqual(['SWR34K, hold at AMIKI as published']);

    run(state, PILOT_DELAY_MAX_S + 1);
    expect(transmissions(drainEvents(state))).toEqual(['hold at AMIKI, SWR34K']);
    expect(ac.holding).toMatchObject({ fix: 'AMIKI', leg: 'entry' });
    expect(ac.target.directTo).toBe('AMIKI');
    expect(ac.phase).toBe('VECTOR');

    // 15 NM out, so the fix is not reached within the first minute.
    run(state, 30);
    expect(ac.holding?.leg).toBe('entry');
  });

  it('turns right onto the outbound leg when the fix is crossed', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    for (let i = 0; i < 300 && ac.holding?.leg === 'entry'; i += 1) tick(state);
    expect(ac.holding?.leg).not.toBe('entry');
    expect(ac.target.directTo).toBeUndefined();
    // The outbound leg flies the reciprocal of the crossing track.
    expect(distanceNm(ac.pos, AMIKI)).toBeLessThanOrEqual(1.05);
  });

  it('flies one-minute outbound legs', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    let outboundStartedAt: number | null = null;
    for (let i = 0; i < 900; i += 1) {
      tick(state);
      if (outboundStartedAt === null && ac.holding?.leg === 'outbound') {
        outboundStartedAt = state.time;
      }
      if (outboundStartedAt !== null && ac.holding?.leg === 'turnIn') {
        // One minute of leg plus the tick that notices it is over.
        expect(state.time - outboundStartedAt).toBeGreaterThanOrEqual(60);
        expect(state.time - outboundStartedAt).toBeLessThanOrEqual(61);
        return;
      }
    }
    throw new Error('the outbound leg never ended');
  });

  it('keeps the aircraft stable at the fix for a whole session (DoD M4)', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    let crossings = 0;
    let previousLeg = ac.holding?.leg;
    let furthest = 0;
    let inPattern = false;
    for (let i = 0; i < 900; i += 1) {
      tick(state);
      if (!inPattern && previousLeg === 'entry' && ac.holding?.leg !== 'entry') {
        inPattern = true; // the racetrack starts at the fix
        previousLeg = ac.holding?.leg;
        continue;
      }
      if (!inPattern) {
        previousLeg = ac.holding?.leg;
        continue;
      }
      furthest = Math.max(furthest, distanceNm(ac.pos, AMIKI));
      if (previousLeg !== 'turnOut' && ac.holding?.leg === 'turnOut') crossings += 1;
      previousLeg = ac.holding?.leg;
    }

    // Still holding, and the pattern re-crosses the fix instead of wandering.
    expect(inPattern).toBe(true);
    expect(ac.holding?.leg).toBeDefined();
    expect(crossings).toBeGreaterThanOrEqual(2);
    // A 1-minute leg at ~290 kt plus the 180° turns fits inside 10 NM.
    expect(furthest).toBeLessThan(10);
  });

  it('stays stable at the fix against the sector wind as well (DoD M4)', () => {
    const { state, ac } = setup(true);
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    let crossings = 0;
    let previousLeg = ac.holding?.leg;
    let furthest = 0;
    let inPattern = false;
    for (let i = 0; i < 900; i += 1) {
      tick(state);
      if (!inPattern && previousLeg === 'entry' && ac.holding?.leg !== 'entry') {
        inPattern = true;
        previousLeg = ac.holding?.leg;
        continue;
      }
      if (!inPattern) {
        previousLeg = ac.holding?.leg;
        continue;
      }
      furthest = Math.max(furthest, distanceNm(ac.pos, AMIKI));
      if (previousLeg !== 'turnOut' && ac.holding?.leg === 'turnOut') crossings += 1;
      previousLeg = ac.holding?.leg;
    }

    expect(inPattern).toBe(true);
    expect(ac.holding?.leg).toBeDefined();
    expect(crossings).toBeGreaterThanOrEqual(2);
    expect(furthest).toBeLessThan(12);
  });

  it('replaces an approach clearance with the hold', () => {
    const { state, ac } = setup();
    ac.phase = 'CLEARED_ILS';
    ac.clearedIls = '14';
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    expect(ac.holding).toBeDefined();
    expect(ac.clearedIls).toBeUndefined();
    expect(ac.phase).toBe('VECTOR');
  });

  it('ends when a heading clearance arrives', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);
    expect(ac.holding).toBeDefined();

    dispatch(state, 'SWR34K', [{ kind: 'heading', deg: 90, turn: 'L' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    expect(ac.holding).toBeUndefined();
    expect(ac.target.heading).toEqual({ deg: 90, turn: 'L' });
    expect(ac.target.directTo).toBeUndefined();
  });

  it('is refused at a fix the airport does not know', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'FOOBA' }]);
    expect(transmissions(drainEvents(state))).toEqual(['SWR34K, hold at FOOBA as published']);
    run(state, PILOT_DELAY_MAX_S + 1);

    expect(transmissions(drainEvents(state))).toEqual(['unable, unknown fix, SWR34K']);
    expect(ac.holding).toBeUndefined();
  });
});

describe('direct clearances (SPEC §5.2, §11.3, M4)', () => {
  it('steers at the fix from now on', () => {
    const { state, ac } = setup();
    const oktav = airport.fixes['OKTAV']!;

    dispatch(state, 'SWR34K', [{ kind: 'direct', fix: 'OKTAV' }]);
    expect(transmissions(drainEvents(state))).toEqual(['SWR34K, proceed direct OKTAV']);
    run(state, PILOT_DELAY_MAX_S + 1);
    expect(transmissions(drainEvents(state))).toEqual(['direct OKTAV, SWR34K']);

    expect(ac.target.directTo).toBe('OKTAV');
    expect(ac.phase).toBe('VECTOR');
    // AMIKI → OKTAV is 17 NM; a minute of flying must close most of the gap.
    const afterReadback = distanceNm(ac.pos, oktav);
    run(state, 60);
    expect(distanceNm(ac.pos, oktav)).toBeLessThan(afterReadback - 2);
  });

  it('is refused at an unknown fix and replaces a hold', () => {
    const { state, ac } = setup();
    dispatch(state, 'SWR34K', [{ kind: 'hold', fix: 'AMIKI' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    dispatch(state, 'SWR34K', [{ kind: 'direct', fix: 'FOOBA' }]);
    run(state, PILOT_DELAY_MAX_S + 1);
    expect(transmissions(drainEvents(state))).toContain('unable, unknown fix, SWR34K');
    expect(ac.target.directTo).toBe('AMIKI'); // the hold is untouched

    dispatch(state, 'SWR34K', [{ kind: 'direct', fix: 'OKTAV' }]);
    run(state, PILOT_DELAY_MAX_S + 1);
    expect(ac.holding).toBeUndefined();
    expect(ac.target.directTo).toBe('OKTAV');
  });

  it('replaces an approach clearance too', () => {
    const { state, ac } = setup();
    ac.phase = 'GS';
    ac.clearedIls = '14';

    dispatch(state, 'SWR34K', [{ kind: 'direct', fix: 'OKTAV' }]);
    run(state, PILOT_DELAY_MAX_S + 1);

    expect(ac.clearedIls).toBeUndefined();
    expect(ac.phase).toBe('VECTOR');
    expect(ac.target.directTo).toBe('OKTAV');
  });
});
