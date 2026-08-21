/**
 * Airport data (SPEC §13.2) and aircraft spawning.
 * Full schema validation of the airport file arrives with M2 (SPEC §14).
 */

import rawAirport from '../data/airports/training-west.json';
import { aircraftProfile, type AircraftState } from './aircraft';
import { emit } from './events';
import { vec2, type Vec2 } from './geo';
import type { Phase } from './phases';
import { iasToTas, type WindProfile } from './physics';
import { randomInt } from './rng';
import type { SimState } from './state';
import { initialCall, radarContact } from '../phraseology';

export interface Runway {
  id: string;
  /** Threshold position in NM. */
  thr: Vec2;
  /** Final approach course, ° true. */
  course: number;
  gsAngle: number;
}

export interface StarProcedure {
  name: string;
  route: string[];
  entryAlt: number;
}

export interface MvaSector {
  polygon: Vec2[];
  minAlt: number;
}

export interface SpawnEntry {
  /** Sim time in seconds. */
  t: number;
  callsign: string;
  type: string;
  star: string;
}

export interface Airport {
  name: string;
  towerFreq: string;
  runways: Runway[];
  fixes: Record<string, Vec2>;
  stars: StarProcedure[];
  mva: MvaSector[];
  windProfile: WindProfile;
  spawn: SpawnEntry[];
}

const pair = (p: readonly number[]): Vec2 => vec2(p[0] ?? 0, p[1] ?? 0);

function toAirport(raw: typeof rawAirport): Airport {
  return {
    name: raw.name,
    towerFreq: raw.towerFreq,
    runways: raw.runways.map((r) => ({
      id: r.id,
      thr: pair(r.thr),
      course: r.course,
      gsAngle: r.gsAngle,
    })),
    fixes: Object.fromEntries(Object.entries(raw.fixes).map(([name, p]) => [name, pair(p)])),
    stars: raw.stars.map((s) => ({ name: s.name, route: [...s.route], entryAlt: s.entryAlt })),
    mva: raw.mva.map((m) => ({ polygon: m.polygon.map(pair), minAlt: m.minAlt })),
    windProfile: raw.windProfile,
    spawn: raw.spawn.map((s) => ({ ...s })),
  };
}

export const TRAINING_WEST: Airport = toAirport(rawAirport);

export function findRunway(airport: Airport, id: string): Runway | undefined {
  return airport.runways.find((r) => r.id === id);
}

export function findStar(airport: Airport, name: string): StarProcedure | undefined {
  return airport.stars.find((s) => s.name === name);
}

/** Seeded transponder code; the emergency codes are skipped. */
export function assignSquawk(state: SimState): string {
  for (;;) {
    const code = Array.from({ length: 4 }, () => randomInt(state, 0, 7)).join('');
    if (code !== '7500' && code !== '7600' && code !== '7700') return code;
  }
}

export interface SpawnSpec {
  callsign: string;
  /** Key into aircraft.json */
  type: string;
  pos: Vec2;
  altitude: number;
  heading: number;
  ias: number;
  targetAltitude?: number;
  targetSpeed?: number;
  star?: string;
  phase?: Phase;
}

/**
 * Puts an aircraft on frequency: it checks in (SPEC §10) and is told
 * "radar contact".
 */
export function spawnAircraft(state: SimState, spec: SpawnSpec): AircraftState {
  const profile = aircraftProfile(spec.type);
  const targetAltitude = spec.targetAltitude ?? spec.altitude;

  const ac: AircraftState = {
    id: `ac${state.nextId++}`,
    callsign: spec.callsign.toUpperCase(),
    type: spec.type,
    pos: { ...spec.pos },
    altitude: spec.altitude,
    heading: spec.heading,
    track: spec.heading,
    ias: spec.ias,
    tas: iasToTas(spec.ias, spec.altitude),
    gs: iasToTas(spec.ias, spec.altitude),
    vs: 0,
    target: {
      heading: { deg: spec.heading, turn: 'auto' },
      altitude: targetAltitude,
      speed: spec.targetSpeed ?? spec.ias,
    },
    phase: spec.phase ?? 'VECTOR',
    wake: profile.wake,
    squawk: assignSquawk(state),
    onFrequency: true,
    pilot: { queue: [] },
    spawnedAt: state.time,
    labelOffset: vec2(34, -26),
    trail: [],
    ...(spec.star ? { star: spec.star } : {}),
  };

  state.aircraft.push(ac);

  emit(state, { kind: 'spawned', callsign: ac.callsign, star: spec.star ?? '' });
  emit(state, {
    kind: 'transmission',
    from: 'pilot',
    callsign: ac.callsign,
    text: initialCall({
      callsign: ac.callsign,
      ...(spec.star ? { star: spec.star } : {}),
      altitude: ac.altitude,
      targetAltitude,
    }),
  });
  emit(state, {
    kind: 'transmission',
    from: 'atc',
    callsign: ac.callsign,
    text: radarContact(ac.callsign),
  });

  return ac;
}
