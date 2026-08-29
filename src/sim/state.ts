/**
 * SimState, the fixed-timestep tick and the radar snapshot pipeline (SPEC §3).
 *
 * One tick is exactly one second of sim time. Time acceleration means more
 * ticks per real second, never a longer tick.
 */

import { aircraftProfile, hasLeftSector, type AircraftState, type WakeCategory } from './aircraft';
import { HEARBACK_ERROR_RATE, SNAPSHOT_INTERVAL_S, TICK_SECONDS, TRAIL_LENGTH } from './constants';
import { emit, type SimEventRecord } from './events';
import type { Vec2 } from './geo';
import { updateHolding } from './holding';
import type { Phase } from './phases';
import { updateStarNavigation } from './phases';
import { updateApproach } from './approach';
import { CALM, stepAircraft, type WindProfile } from './physics';
import { processPilotQueue } from './pilot';
import { spawnAircraft, spawnSpecFor, type Airport, type SpawnEntry } from './scenario';
import { findConflicts, findStcaPairs, pairKey, violatesMva, type Pair } from './separation';

export { emit } from './events';
export type { SimEvent, SimEventRecord } from './events';
export { nextRandom, randomInt, randomNormal } from './rng';

/** What the radar shows for one aircraft — frozen at snapshot time (SPEC §3, §9). */
export interface RadarContact {
  id: string;
  callsign: string;
  type: string;
  pos: Vec2;
  altitude: number;
  gs: number;
  vs: number;
  targetAltitude: number;
  wake: WakeCategory;
  phase: Phase;
  /** Past snapshot positions, oldest first. */
  trail: Vec2[];
  /** Data block offset in screen px; written through by the label drag. */
  labelOffset: Vec2;
  /** 'conflict' = separation lost, 'stca' = predicted conflict (SPEC §8). */
  alert: 'none' | 'stca' | 'conflict';
}

export interface RadarSnapshot {
  /** Sim time the picture was frozen at. */
  time: number;
  contacts: RadarContact[];
}

/** A flight that has left the sector, for the debriefing (SPEC §11.5). */
export interface CompletedFlight {
  callsign: string;
  /** False when it landed without ever being handed to the tower. */
  handedOff: boolean;
  /** Sim time it left the sector. */
  at: number;
  /** Seconds between check-in and leaving. */
  timeInSector: number;
}

export interface SimState {
  /** Sim time in seconds since session start. */
  time: number;
  seed: number;
  rngState: number;
  aircraft: AircraftState[];
  /** Drained by the host once per frame. */
  events: SimEventRecord[];
  /** The only picture the radar is allowed to draw. */
  snapshot: RadarSnapshot | null;
  wind: WindProfile;
  airport: Airport | null;
  /**
   * Chance per transmission that a pilot mishears one numeric value
   * (SPEC §6, M4). Tests that pin down pre-M4 behaviour set it to 0.
   */
  hearbackErrorRate: number;
  /** Scheduled traffic still to come, earliest first (SPEC §13.2). */
  pendingSpawns: SpawnEntry[];
  /** Callsign pairs currently under a conflict alert, refreshed every 4 s. */
  stcaPairs: Pair[];
  /** Pair keys already reported as a loss, so one conflict fires once. */
  activeConflicts: string[];
  /** Callsigns that already produced an MVA violation (SPEC §8: once each). */
  mvaReported: string[];
  /** Flights that have left the sector, in the order they did. */
  completed: CompletedFlight[];
  nextId: number;
}

export interface SimStateOptions {
  seed?: number;
  airport?: Airport;
  /**
   * Wind stays calm until M3 turns the airport profile on (SPEC §14), so it is
   * opt-in rather than taken from the airport automatically.
   */
  wind?: WindProfile;
  /** Overrides the default hearback error rate (SPEC §6). */
  hearbackErrorRate?: number;
}

const NO_FIXES: Readonly<Record<string, Vec2>> = {};

export function createSimState(options: SimStateOptions = {}): SimState {
  const seed = options.seed ?? 1;
  const airport = options.airport ?? null;
  return {
    time: 0,
    seed,
    rngState: seed | 0,
    aircraft: [],
    events: [],
    snapshot: null,
    wind: options.wind ?? CALM,
    airport,
    hearbackErrorRate: options.hearbackErrorRate ?? HEARBACK_ERROR_RATE,
    pendingSpawns: airport ? [...airport.spawn] : [],
    stcaPairs: [],
    activeConflicts: [],
    mvaReported: [],
    completed: [],
    nextId: 1,
  };
}

export function findAircraft(state: SimState, callsign: string): AircraftState | undefined {
  const wanted = callsign.trim().toUpperCase();
  return state.aircraft.find((ac) => ac.callsign.toUpperCase() === wanted);
}

export function towerFrequency(state: SimState): string {
  return state.airport?.towerFreq ?? '118.1';
}

/** Hands the queued events to the host and clears the queue. */
export function drainEvents(state: SimState): SimEventRecord[] {
  const drained = state.events;
  state.events = [];
  return drained;
}

/**
 * The label offset is presentation state that lives on the aircraft (SPEC §9).
 * It is written through to the current snapshot so dragging stays at 60 fps
 * instead of waiting for the next radar sweep.
 */
export function setLabelOffset(state: SimState, id: string, offset: Vec2): void {
  const ac = state.aircraft.find((a) => a.id === id);
  if (ac) ac.labelOffset = offset;
  const contact = state.snapshot?.contacts.find((c) => c.id === id);
  if (contact) contact.labelOffset = offset;
}

/** SPEC §13.2: scheduled traffic checks in when its time comes. */
function spawnDueTraffic(state: SimState): void {
  const airport = state.airport;
  if (!airport) return;

  while (state.pendingSpawns.length > 0 && (state.pendingSpawns[0] as SpawnEntry).t <= state.time) {
    const entry = state.pendingSpawns.shift() as SpawnEntry;
    const spec = spawnSpecFor(airport, entry);
    if (spec) spawnAircraft(state, spec);
  }
}

/** SPEC §8: separation is checked every sim second on live data. */
function checkSeparation(state: SimState): void {
  const conflicts = findConflicts(state.aircraft);
  const keys = conflicts.map((c) => pairKey(c.a, c.b));

  for (const conflict of conflicts) {
    const key = pairKey(conflict.a, conflict.b);
    if (state.activeConflicts.includes(key)) continue;
    state.activeConflicts.push(key);
    emit(state, { kind: 'separationLoss', a: conflict.a, b: conflict.b });
  }

  // A pair can only be reported again once it has been separated in between.
  state.activeConflicts = state.activeConflicts.filter((key) => keys.includes(key));
}

/** SPEC §8: an MVA bust is a controller error and is reported once per aircraft. */
function checkMva(state: SimState): void {
  const sectors = state.airport?.mva ?? [];
  if (sectors.length === 0) return;

  for (const ac of state.aircraft) {
    if (state.mvaReported.includes(ac.callsign)) continue;
    if (!violatesMva(ac, sectors)) continue;
    state.mvaReported.push(ac.callsign);
    emit(state, { kind: 'mvaViolation', callsign: ac.callsign });
  }
}

/** SPEC §8: the conflict prediction runs with the radar sweep, every 4 s. */
function updateStca(state: SimState): void {
  state.stcaPairs = findStcaPairs(state.aircraft);
  if (state.stcaPairs.length > 0) {
    emit(state, { kind: 'stca', pairs: state.stcaPairs.map((p) => [p.a, p.b]) });
  }
}

function alertFor(state: SimState, callsign: string): RadarContact['alert'] {
  const inConflict = state.activeConflicts.some((key) => key.split('|').includes(callsign));
  if (inConflict) return 'conflict';
  if (state.stcaPairs.some((p) => p.a === callsign || p.b === callsign)) return 'stca';
  return 'none';
}

/** SPEC §3: freeze the radar picture, including the trail history. */
export function captureSnapshot(state: SimState): RadarSnapshot {
  const contacts: RadarContact[] = [];

  for (const ac of state.aircraft) {
    if (ac.phase === 'DONE') continue;
    ac.trail.push({ ...ac.pos });
    if (ac.trail.length > TRAIL_LENGTH) ac.trail.splice(0, ac.trail.length - TRAIL_LENGTH);

    contacts.push({
      id: ac.id,
      callsign: ac.callsign,
      type: ac.type,
      pos: { ...ac.pos },
      altitude: ac.altitude,
      gs: ac.gs,
      vs: ac.vs,
      targetAltitude: ac.target.altitude,
      wake: ac.wake,
      phase: ac.phase,
      trail: ac.trail.map((p) => ({ ...p })),
      labelOffset: { ...ac.labelOffset },
      alert: alertFor(state, ac.callsign),
    });
  }

  state.snapshot = { time: state.time, contacts };
  return state.snapshot;
}

/** One simulation second (SPEC §5, order of operations). */
export function tick(state: SimState): void {
  state.time += TICK_SECONDS;
  spawnDueTraffic(state);

  const fixes = state.airport?.fixes ?? NO_FIXES;

  for (const ac of state.aircraft) {
    if (hasLeftSector(ac)) continue;
    processPilotQueue(state, ac);
    updateStarNavigation(ac, fixes);
    updateApproach(state, ac);
    updateHolding(ac, fixes, state.wind, TICK_SECONDS);
    // The approach can take the aircraft out of the sector mid-tick.
    if (hasLeftSector(ac)) continue;
    stepAircraft(ac, aircraftProfile(ac.type), state.wind, fixes, TICK_SECONDS);
  }

  checkSeparation(state);
  checkMva(state);

  if (state.time % SNAPSHOT_INTERVAL_S === 0) {
    updateStca(state);
    captureSnapshot(state);
  }
}
