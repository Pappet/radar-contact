/**
 * SimState, the fixed-timestep tick and the radar snapshot pipeline (SPEC §3).
 *
 * One tick is exactly one second of sim time. Time acceleration means more
 * ticks per real second, never a longer tick.
 */

import { aircraftProfile, type AircraftState, type WakeCategory } from './aircraft';
import { SNAPSHOT_INTERVAL_S, TICK_SECONDS, TRAIL_LENGTH } from './constants';
import type { SimEventRecord } from './events';
import type { Vec2 } from './geo';
import type { Phase } from './phases';
import { CALM, stepAircraft, type WindProfile } from './physics';
import { processPilotQueue } from './pilot';

export { emit } from './events';
export type { SimEvent, SimEventRecord } from './events';
export { nextRandom, randomInt, randomNormal } from './rng';

/** One aircraft as the radar sees it — frozen at snapshot time (SPEC §3, §9). */
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
}

export interface RadarSnapshot {
  /** Sim time the picture was frozen at. */
  time: number;
  contacts: RadarContact[];
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
  fixes: Record<string, Vec2>;
  towerFreq: string;
  nextId: number;
}

export interface SimStateOptions {
  seed?: number;
  wind?: WindProfile;
  fixes?: Record<string, Vec2>;
  towerFreq?: string;
}

export function createSimState(options: SimStateOptions = {}): SimState {
  const seed = options.seed ?? 1;
  return {
    time: 0,
    seed,
    rngState: seed | 0,
    aircraft: [],
    events: [],
    snapshot: null,
    wind: options.wind ?? CALM,
    fixes: options.fixes ?? {},
    towerFreq: options.towerFreq ?? '118.1',
    nextId: 1,
  };
}

export function findAircraft(state: SimState, callsign: string): AircraftState | undefined {
  const wanted = callsign.trim().toUpperCase();
  return state.aircraft.find((ac) => ac.callsign.toUpperCase() === wanted);
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
    });
  }

  state.snapshot = { time: state.time, contacts };
  return state.snapshot;
}

/** One simulation second (SPEC §5, order of operations). */
export function tick(state: SimState): void {
  state.time += TICK_SECONDS;

  for (const ac of state.aircraft) {
    if (ac.phase === 'DONE') continue;
    processPilotQueue(state, ac);
    stepAircraft(ac, aircraftProfile(ac.type), state.wind, state.fixes, TICK_SECONDS);
  }

  // Separation, STCA and MVA checks hook in here with M2 (SPEC §8).

  if (state.time % SNAPSHOT_INTERVAL_S === 0) captureSnapshot(state);
}
