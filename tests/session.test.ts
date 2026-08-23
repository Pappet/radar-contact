import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/sim/commands';
import { SESSION_LENGTH_S } from '../src/sim/constants';
import { loadTrainingWest } from '../src/sim/scenario';
import { createSimState, drainEvents, tick, type SimState } from '../src/sim/state';
import type { SimEventRecord } from '../src/sim/events';
import type { AircraftState } from '../src/sim/aircraft';
import { approachGeometry } from '../src/sim/approach';
import { summarize } from '../src/score';
import { angleDiff, bearingTo, distanceNm, polarToVec, type Vec2 } from '../src/sim/geo';

const airport = loadTrainingWest();
const runway = airport.runways[0]!;

function session(seed: number): { state: SimState; log: SimEventRecord[] } {
  // The sector wind is on from M3 (SPEC §14).
  return { state: createSimState({ seed, airport, wind: airport.windProfile }), log: [] };
}

function run(state: SimState, log: SimEventRecord[], seconds: number): void {
  for (let i = 0; i < seconds; i += 1) {
    tick(state);
    log.push(...drainEvents(state));
  }
}

/** A point on the extended centerline, `distance` NM from the threshold. */
const onCenterline = (distance: number): Vec2 => polarToVec(runway.course + 180, distance);

/**
 * Plays controller: steers the arrival at a point twelve miles out on the
 * final, levels it at 3000 ft, then turns it onto the course and clears the
 * ILS. At twelve miles the glidepath is still above 3000 ft, so the aircraft
 * joins it from below as SPEC §7 requires.
 */
function vectorOntoIls(
  state: SimState,
  log: SimEventRecord[],
  callsign: string,
  settleSeconds = 20,
): AircraftState {
  const ac = state.aircraft.find((a) => a.callsign === callsign);
  if (!ac) throw new Error(`${callsign} never checked in`);
  const gate = onCenterline(12);

  dispatch(state, callsign, [{ kind: 'altitude', ft: 3000 }, { kind: 'speed', kt: 200 }]);

  for (let i = 0; i < 40; i += 1) {
    dispatch(state, callsign, [{ kind: 'heading', deg: bearingTo(ac.pos, gate), turn: 'auto' }]);
    run(state, log, 20);
    if (distanceNm(ac.pos, gate) < 1.2) break;
  }

  dispatch(state, callsign, [
    { kind: 'heading', deg: runway.course, turn: 'auto' },
    { kind: 'ils', runway: runway.id },
  ]);
  run(state, log, settleSeconds);
  return ac;
}

/** Hands the aircraft to the tower once it is established and close in. */
function flyToTower(state: SimState, log: SimEventRecord[], callsign: string): AircraftState {
  const ac = vectorOntoIls(state, log, callsign);
  let handed = false;

  for (let i = 0; i < 600 && ac.phase !== 'DONE' && ac.phase !== 'GOAROUND'; i += 1) {
    run(state, log, 1);
    const established = ac.phase === 'LOC' || ac.phase === 'GS';
    if (!handed && established && approachGeometry(ac.pos, runway).distance <= 9) {
      dispatch(state, callsign, [{ kind: 'handoff' }]);
      handed = true;
    }
  }
  return ac;
}

describe('a full approach with wind (DoD M3)', () => {
  it('takes an arrival from check-in to the tower', () => {
    const { state, log } = session(2024);
    run(state, log, 25); // SWR34K checks in at t = 20

    const ac = flyToTower(state, log, 'SWR34K');
    expect(ac.phase).toBe('DONE');

    const completed = state.completed.find((f) => f.callsign === 'SWR34K');
    expect(completed?.handedOff).toBe(true);
    expect(completed!.timeInSector).toBeGreaterThan(0);

    expect(log.some((r) => r.event.kind === 'handoffComplete')).toBe(true);
    expect(log.some((r) => r.event.kind === 'goAround')).toBe(false);
  });

  it('walks through the phases in order', () => {
    const { state, log } = session(2024);
    run(state, log, 25);

    const ac = vectorOntoIls(state, log, 'SWR34K', 0);
    const seen: string[] = [ac.phase];
    for (let i = 0; i < 600 && ac.phase !== 'DONE'; i += 1) {
      run(state, log, 1);
      if (seen[seen.length - 1] !== ac.phase) seen.push(ac.phase);
    }

    expect(seen).toContain('CLEARED_ILS');
    expect(seen.indexOf('LOC')).toBeGreaterThan(seen.indexOf('CLEARED_ILS'));
    expect(seen.indexOf('GS')).toBeGreaterThan(seen.indexOf('LOC'));
    expect(seen).not.toContain('GOAROUND');
  });

  it('holds the centerline against the crosswind', () => {
    const { state, log } = session(2024);
    run(state, log, 25);

    const ac = vectorOntoIls(state, log, 'SWR34K');

    let established = false;
    let worstOffset = 0;
    let crabbed = false;
    for (let i = 0; i < 600 && ac.phase !== 'DONE' && ac.phase !== 'GOAROUND'; i += 1) {
      run(state, log, 1);
      const geometry = approachGeometry(ac.pos, runway);
      if (ac.phase === 'LOC' || ac.phase === 'GS') {
        established = true;
        if (geometry.distance < 9) {
          worstOffset = Math.max(worstOffset, Math.abs(geometry.lateral));
          if (Math.abs(angleDiff(runway.course, ac.heading)) > 2) crabbed = true;
        }
      }
    }

    expect(established).toBe(true);
    // Wind or not, it stays on the centerline once established.
    expect(worstOffset).toBeLessThan(0.3);
    // And it holds off into the wind rather than simply flying the course.
    expect(crabbed).toBe(true);
  });

  it('comes down the glidepath and slows to approach speed', () => {
    const { state, log } = session(2024);
    run(state, log, 25);
    const ac = vectorOntoIls(state, log, 'SWR34K');

    let onPathAtFive: number | null = null;
    let speedAtThree: number | null = null;
    for (let i = 0; i < 600 && ac.phase !== 'DONE'; i += 1) {
      run(state, log, 1);
      const { distance, glidepath } = approachGeometry(ac.pos, runway);
      if (onPathAtFive === null && ac.phase === 'GS' && distance <= 5) {
        onPathAtFive = Math.abs(ac.altitude - glidepath);
      }
      if (speedAtThree === null && distance <= 3) speedAtThree = ac.ias;
    }

    expect(onPathAtFive).not.toBeNull();
    expect(onPathAtFive!).toBeLessThan(120);
    // A320 vApp is 137 kt, and it should be there by three miles.
    expect(speedAtThree!).toBeLessThan(145);
  });
});

describe('session end (SPEC §11.5)', () => {
  it('summarises what happened', () => {
    const { state, log } = session(2024);
    run(state, log, 25);
    flyToTower(state, log, 'SWR34K');

    const airborne = state.aircraft.filter((a) => a.phase !== 'DONE').length;
    const summary = summarize(log, state.completed, airborne);

    expect(summary.handoffs).toBe(1);
    expect(summary.score).toBe(
      100 - 1000 * summary.separationLosses - 300 * summary.mvaViolations - 200 * summary.goArounds,
    );
    expect(summary.averageTimeInSector).toBeGreaterThan(0);
    expect(summary.stillAirborne).toBe(airborne);
  });

  it('runs the whole scheduled session without losing anyone', () => {
    const { state, log } = session(7);
    run(state, log, SESSION_LENGTH_S);

    expect(state.time).toBe(SESSION_LENGTH_S);
    expect(state.pendingSpawns).toHaveLength(0);
    expect(log.filter((r) => r.event.kind === 'spawned')).toHaveLength(6);

    const airborne = state.aircraft.filter((a) => a.phase !== 'DONE').length;
    expect(state.completed.length + airborne).toBe(6);

    // Left alone nobody is handed over — that is a zero, not a crash.
    const summary = summarize(log, state.completed, airborne);
    expect(summary.handoffs).toBe(0);
    expect(Number.isFinite(summary.score)).toBe(true);
  });
});
