import { describe, expect, it } from 'vitest';
import {
  approachGeometry,
  canCaptureGlidepath,
  canCaptureLocalizer,
  canHandOff,
  glidepathAt,
  precedingOnFinal,
  updateApproach,
} from '../src/sim/approach';
import type { AircraftState } from '../src/sim/aircraft';
import type { Phase } from '../src/sim/phases';
import { add, polarToVec, type Vec2 } from '../src/sim/geo';
import { loadTrainingWest, spawnAircraft } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import type { SimEvent, SimEventRecord } from '../src/sim/events';

const airport = loadTrainingWest();
const runway = airport.runways[0]!;
const COURSE = runway.course; // 137°

/** A point `distance` NM out on the final, offset sideways by `lateral` NM. */
function onFinal(distance: number, lateral = 0): Vec2 {
  return add(polarToVec(COURSE + 180, distance), polarToVec(COURSE + 270, lateral));
}

interface Setup {
  distance: number;
  lateral?: number;
  altitude?: number;
  track?: number;
  vs?: number;
  phase?: Phase;
  ias?: number;
  clearedIls?: boolean;
  /** Key into aircraft.json — decides the wake category (M4). */
  type?: string;
}

function approaching(state: SimState, callsign: string, setup: Setup): AircraftState {
  const ac = spawnAircraft(state, {
    callsign,
    type: setup.type ?? 'A320',
    pos: onFinal(setup.distance, setup.lateral ?? 0),
    altitude: setup.altitude ?? 3000,
    heading: setup.track ?? COURSE,
    ias: setup.ias ?? 180,
  });
  ac.track = setup.track ?? COURSE;
  ac.vs = setup.vs ?? 0;
  ac.phase = setup.phase ?? 'CLEARED_ILS';
  if (setup.clearedIls !== false) ac.clearedIls = runway.id;
  drainEvents(state);
  return ac;
}

const events = (log: SimEventRecord[], kind: SimEvent['kind']): SimEvent[] =>
  log.filter((r) => r.event.kind === kind).map((r) => r.event);

describe('approach geometry (SPEC §7)', () => {
  it('measures distance along the course and offset across it', () => {
    const straight = approachGeometry(onFinal(10), runway);
    expect(straight.distance).toBeCloseTo(10, 6);
    expect(straight.lateral).toBeCloseTo(0, 6);
    expect(straight.glidepath).toBeCloseTo(3180, 6);

    const offset = approachGeometry(onFinal(6, 0.4), runway);
    expect(offset.distance).toBeCloseTo(6, 6);
    expect(offset.lateral).toBeCloseTo(0.4, 6);
  });

  it('turns negative once past the threshold', () => {
    expect(approachGeometry(onFinal(-2), runway).distance).toBeCloseTo(-2, 6);
  });

  it('puts the glidepath at 318 ft per mile and never below the ground', () => {
    expect(glidepathAt(10)).toBe(3180);
    expect(glidepathAt(3)).toBe(954);
    expect(glidepathAt(0)).toBe(0);
    expect(glidepathAt(-5)).toBe(0);
  });
});

describe('localizer capture (SPEC §7, DoD M3)', () => {
  const state = createSimState({ seed: 1, airport });

  it('captures from the left and from the right', () => {
    const fromRight = approaching(state, 'AAA111', {
      distance: 8, lateral: 0.4, track: COURSE - 25,
    });
    expect(canCaptureLocalizer(fromRight, runway)).toBe(true);

    const fromLeft = approaching(state, 'BBB222', {
      distance: 8, lateral: -0.4, track: COURSE + 25,
    });
    expect(canCaptureLocalizer(fromLeft, runway)).toBe(true);
  });

  it('refuses an intercept angle beyond 30°', () => {
    const steep = approaching(state, 'CCC333', {
      distance: 8, lateral: 0.2, track: COURSE + 40,
    });
    expect(canCaptureLocalizer(steep, runway)).toBe(false);

    const justInside = approaching(state, 'DDD444', {
      distance: 8, lateral: 0.2, track: COURSE + 30,
    });
    expect(canCaptureLocalizer(justInside, runway)).toBe(true);
  });

  it('refuses when it is too far off the centerline', () => {
    const wide = approaching(state, 'EEE555', { distance: 8, lateral: 0.9, track: COURSE });
    expect(canCaptureLocalizer(wide, runway)).toBe(false);

    const justInside = approaching(state, 'FFF666', { distance: 8, lateral: 0.49, track: COURSE });
    expect(canCaptureLocalizer(justInside, runway)).toBe(true);

    const justOutside = approaching(state, 'HHH888', { distance: 8, lateral: 0.51, track: COURSE });
    expect(canCaptureLocalizer(justOutside, runway)).toBe(false);
  });

  it('refuses behind the threshold', () => {
    const past = approaching(state, 'GGG777', { distance: -1, track: COURSE });
    expect(canCaptureLocalizer(past, runway)).toBe(false);
  });

  it('switches the phase and drops any direct-to when it captures', () => {
    const fresh = createSimState({ seed: 2, airport });
    const ac = approaching(fresh, 'SWR34K', { distance: 8, lateral: 0.3, track: COURSE - 20 });
    ac.target.directTo = 'OKTAV';

    updateApproach(fresh, ac);

    expect(ac.phase).toBe('LOC');
    expect(ac.target.directTo).toBeUndefined();
  });
});

describe('glidepath capture (SPEC §7, DoD M3)', () => {
  const state = createSimState({ seed: 3, airport });

  it('captures when the path comes down onto a level aircraft', () => {
    // At 10 NM the path sits at 3180 ft.
    const level = approaching(state, 'AAA111', {
      distance: 10, altitude: 3100, vs: 0, phase: 'LOC',
    });
    expect(canCaptureGlidepath(level, runway, 240)).toBe(true);
  });

  it('stays level when the path is still far above', () => {
    const low = approaching(state, 'BBB222', {
      distance: 10, altitude: 2000, vs: 0, phase: 'LOC',
    });
    expect(canCaptureGlidepath(low, runway, 240)).toBe(false);
  });

  it('never captures from above', () => {
    const high = approaching(state, 'CCC333', {
      distance: 10, altitude: 3400, vs: 0, phase: 'LOC',
    });
    expect(canCaptureGlidepath(high, runway, 240)).toBe(false);

    // Diving through the path is not a capture either: the aircraft sinks
    // faster than the path does.
    const diving = approaching(state, 'DDD444', {
      distance: 10, altitude: 3100, vs: -2000, phase: 'LOC',
    });
    expect(canCaptureGlidepath(diving, runway, 240)).toBe(false);
  });

  it('follows the path down once established', () => {
    const fresh = createSimState({ seed: 4, airport });
    const ac = approaching(fresh, 'SWR34K', {
      distance: 10, altitude: 3100, vs: 0, phase: 'LOC',
    });
    ac.gs = 240;

    updateApproach(fresh, ac);
    expect(ac.phase).toBe('GS');
    // The target now sits on the path a tick ahead, so it descends.
    expect(ac.target.altitude).toBeLessThan(3180);
    expect(ac.target.altitude).toBeGreaterThan(3000);
  });

  it('is at final approach speed by five miles', () => {
    const fresh = createSimState({ seed: 5, airport });
    const ac = approaching(fresh, 'SWR34K', {
      distance: 4.5, altitude: glidepathAt(4.5), phase: 'GS', ias: 180,
    });
    ac.gs = 200;

    updateApproach(fresh, ac);
    expect(ac.target.speed).toBe(137); // A320 vApp
  });
});

describe('go-around triggers (SPEC §7, DoD M3)', () => {
  it('sends an aircraft around that is not established at six miles', () => {
    const state = createSimState({ seed: 6, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, lateral: 3, track: COURSE, phase: 'CLEARED_ILS',
    });

    updateApproach(state, ac);

    expect(ac.phase).toBe('GOAROUND');
    expect(events(drainEvents(state), 'goAround')).toEqual([
      { kind: 'goAround', callsign: 'SWR34K', reason: 'notEstablished' },
    ]);
    expect(ac.target.altitude).toBe(4000);
    expect(ac.clearedIls).toBeUndefined();
  });

  it('announces the missed approach on the radio', () => {
    const state = createSimState({ seed: 18, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, lateral: 3, phase: 'CLEARED_ILS',
    });

    updateApproach(state, ac);

    const spoken = drainEvents(state)
      .filter((r) => r.event.kind === 'transmission')
      .map((r) => (r.event as { text: string }).text);
    expect(spoken).toContain('going around, SWR34K');
  });

  it('sends an aircraft around that arrives too high', () => {
    const state = createSimState({ seed: 7, airport });
    // The path is at 1908 ft here; more than 300 ft above is too high.
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, altitude: 2400, phase: 'LOC',
    });

    updateApproach(state, ac);

    expect(ac.phase).toBe('GOAROUND');
    expect(events(drainEvents(state), 'goAround')).toEqual([
      { kind: 'goAround', callsign: 'SWR34K', reason: 'tooHigh' },
    ]);
  });

  it('lets an aircraft through that is established and on profile', () => {
    const state = createSimState({ seed: 8, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, altitude: glidepathAt(5.9) + 100, phase: 'LOC',
    });

    updateApproach(state, ac);

    expect(ac.phase).not.toBe('GOAROUND');
    expect(events(drainEvents(state), 'goAround')).toEqual([]);
  });

  it('judges the gate only once', () => {
    const state = createSimState({ seed: 9, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, altitude: glidepathAt(5.9), phase: 'LOC',
    });

    updateApproach(state, ac);
    expect(ac.gateChecked).toBe(true);
    // Even if it drifts high afterwards, the gate does not fire again.
    ac.altitude = 4000;
    updateApproach(state, ac);
    expect(events(drainEvents(state), 'goAround')).toEqual([]);
  });

  it('sends an aircraft around that closes on the one ahead', () => {
    const state = createSimState({ seed: 10, airport });
    const leader = approaching(state, 'AAA111', {
      distance: 2, altitude: glidepathAt(2), phase: 'GS',
    });
    leader.gateChecked = true;
    const follower = approaching(state, 'BBB222', {
      distance: 4, altitude: glidepathAt(4), phase: 'GS',
    });
    follower.gateChecked = true;

    updateApproach(state, follower);

    expect(follower.phase).toBe('GOAROUND');
    expect(events(drainEvents(state), 'goAround')).toEqual([
      { kind: 'goAround', callsign: 'BBB222', reason: 'spacing' },
    ]);
  });

  it('applies the wake matrix: a medium fires behind a heavy, not behind a medium (DoD M4)', () => {
    // The spacing window opens at four miles, so the discriminating geometry
    // is inside it: same gap, same follower — only the leader's wake differs.
    const heavyState = createSimState({ seed: 19, airport });
    const heavy = approaching(heavyState, 'AAA111', {
      distance: 0.5, type: 'B77W', altitude: glidepathAt(0.5), phase: 'GS',
    });
    heavy.gateChecked = true;
    const mediumBehindHeavy = approaching(heavyState, 'BBB222', {
      distance: 3.8, altitude: glidepathAt(3.8), phase: 'GS',
    });
    mediumBehindHeavy.gateChecked = true;
    updateApproach(heavyState, mediumBehindHeavy);
    // 3.3 NM behind a heavy needs 5 — the medium goes around.
    expect(mediumBehindHeavy.phase).toBe('GOAROUND');
    expect(events(drainEvents(heavyState), 'goAround')).toEqual([
      { kind: 'goAround', callsign: 'BBB222', reason: 'spacing' },
    ]);

    const mediumState = createSimState({ seed: 21, airport });
    const medium = approaching(mediumState, 'CCC333', {
      distance: 0.5, altitude: glidepathAt(0.5), phase: 'GS',
    });
    medium.gateChecked = true;
    const mediumBehindMedium = approaching(mediumState, 'DDD444', {
      distance: 3.8, altitude: glidepathAt(3.8), phase: 'GS',
    });
    mediumBehindMedium.gateChecked = true;
    updateApproach(mediumState, mediumBehindMedium);
    // The same 3.3 NM behind a medium needs only 3 — it stays on the ILS.
    expect(mediumBehindMedium.phase).toBe('GS');
    expect(events(drainEvents(mediumState), 'goAround')).toEqual([]);
  });

  it('does not judge spacing before four miles', () => {
    const state = createSimState({ seed: 11, airport });
    const leader = approaching(state, 'AAA111', {
      distance: 3, altitude: glidepathAt(3), phase: 'GS',
    });
    leader.gateChecked = true;
    // Sitting right behind the leader, but still outside the window.
    const follower = approaching(state, 'BBB222', {
      distance: 4.5, altitude: glidepathAt(4.5), phase: 'GS',
    });
    follower.gateChecked = true;

    updateApproach(state, follower);

    expect(follower.phase).toBe('GS');
    const ahead = precedingOnFinal(follower, state.aircraft, runway);
    expect(ahead?.other.callsign).toBe('AAA111');
    expect(ahead?.gap).toBeCloseTo(1.5, 6);
  });

  it('only looks at aircraft that are actually ahead', () => {
    const state = createSimState({ seed: 17, airport });
    const behind = approaching(state, 'AAA111', {
      distance: 6, altitude: glidepathAt(6), phase: 'GS',
    });
    behind.gateChecked = true;
    const front = approaching(state, 'BBB222', {
      distance: 3, altitude: glidepathAt(3), phase: 'GS',
    });
    front.gateChecked = true;

    expect(precedingOnFinal(front, state.aircraft, runway)).toBeNull();
    updateApproach(state, front);
    expect(front.phase).toBe('GS');
  });

  it('climbs straight ahead and hands back to the controller at 4000 ft', () => {
    const state = createSimState({ seed: 12, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 5.9, lateral: 3, phase: 'CLEARED_ILS',
    });
    updateApproach(state, ac);
    expect(ac.phase).toBe('GOAROUND');

    ac.altitude = 3999;
    updateApproach(state, ac);
    expect(ac.phase).toBe('GOAROUND');

    ac.altitude = 4000;
    updateApproach(state, ac);
    expect(ac.phase).toBe('VECTOR');
  });
});

describe('handoff and leaving the sector (SPEC §7)', () => {
  it('only allows the tower when established and inside ten miles', () => {
    const state = createSimState({ seed: 13, airport });

    const far = approaching(state, 'AAA111', { distance: 12, phase: 'LOC' });
    expect(canHandOff(state, far)).toBe(false);

    const notEstablished = approaching(state, 'BBB222', { distance: 8, phase: 'CLEARED_ILS' });
    expect(canHandOff(state, notEstablished)).toBe(false);

    const ready = approaching(state, 'CCC333', { distance: 8, phase: 'LOC' });
    expect(canHandOff(state, ready)).toBe(true);

    const onGlidepath = approaching(state, 'DDD444', { distance: 4, phase: 'GS' });
    expect(canHandOff(state, onGlidepath)).toBe(true);
  });

  it('counts a handed-over flight as cleanly finished', () => {
    const state = createSimState({ seed: 14, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 0.9, altitude: 300, phase: 'HANDOFF',
    });
    ac.gateChecked = true;

    updateApproach(state, ac);

    expect(ac.phase).toBe('DONE');
    expect(events(drainEvents(state), 'handoffComplete')).toEqual([
      { kind: 'handoffComplete', callsign: 'SWR34K' },
    ]);
    expect(state.completed).toEqual([
      { callsign: 'SWR34K', handedOff: true, at: 0, timeInSector: 0 },
    ]);
  });

  it('lands an aircraft that was never handed over, but does not credit it', () => {
    const state = createSimState({ seed: 15, airport });
    const ac = approaching(state, 'SWR34K', {
      distance: 0.9, altitude: 300, phase: 'GS',
    });
    ac.gateChecked = true;

    updateApproach(state, ac);

    expect(ac.phase).toBe('DONE');
    expect(events(drainEvents(state), 'handoffComplete')).toEqual([]);
    expect(state.completed[0]).toMatchObject({ callsign: 'SWR34K', handedOff: false });
  });

  it('drops the aircraft out of the radar picture once it is done', () => {
    const state = createSimState({ seed: 16, airport });
    const ac = approaching(state, 'SWR34K', { distance: 0.9, altitude: 300, phase: 'HANDOFF' });
    ac.gateChecked = true;

    tick(state);
    tick(state);
    tick(state);
    tick(state);

    expect(ac.phase).toBe('DONE');
    expect(state.snapshot?.contacts).toHaveLength(0);
  });
});
