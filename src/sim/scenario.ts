/**
 * Airport data (SPEC §13.2), its validation, and traffic spawning.
 *
 * The airport file is content, so it is checked on load and every problem is
 * reported at once rather than surfacing as a crash three ticks later.
 */

import rawAirport from '../data/airports/training-west.json';
import { AIRCRAFT_TYPES, aircraftProfile, normalSpeed, type AircraftState } from './aircraft';
import { emit } from './events';
import { bearingTo, vec2, type Vec2 } from './geo';
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

export class AirportValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid airport data:\n  - ${issues.join('\n  - ')}`);
    this.name = 'AirportValidationError';
    this.issues = issues;
  }
}

// --- validation helpers -----------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readPair(value: unknown, where: string, issues: string[]): Vec2 {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber)) {
    issues.push(`${where}: expected [x, y] in NM`);
    return vec2(0, 0);
  }
  return vec2(value[0] as number, value[1] as number);
}

function readNumber(
  value: unknown,
  where: string,
  issues: string[],
  range?: { min?: number; max?: number },
): number {
  if (!isFiniteNumber(value)) {
    issues.push(`${where}: expected a number`);
    return 0;
  }
  if (range?.min !== undefined && value < range.min) {
    issues.push(`${where}: ${value} is below the minimum ${range.min}`);
  }
  if (range?.max !== undefined && value > range.max) {
    issues.push(`${where}: ${value} is above the maximum ${range.max}`);
  }
  return value;
}

function readString(value: unknown, where: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${where}: expected a non-empty string`);
    return '';
  }
  return value;
}

function readWindLayer(
  value: unknown,
  where: string,
  issues: string[],
): { dir: number; kt: number } {
  if (!isRecord(value)) {
    issues.push(`${where}: expected { dir, kt }`);
    return { dir: 0, kt: 0 };
  }
  return {
    dir: readNumber(value['dir'], `${where}.dir`, issues, { min: 0, max: 360 }),
    kt: readNumber(value['kt'], `${where}.kt`, issues, { min: 0 }),
  };
}

/**
 * Validates and converts raw airport JSON. Throws AirportValidationError with
 * every problem found, so a broken file is fixed in one pass.
 */
export function parseAirport(raw: unknown): Airport {
  const issues: string[] = [];

  if (!isRecord(raw)) throw new AirportValidationError(['top level: expected an object']);

  const name = readString(raw['name'], 'name', issues);
  const towerFreq = readString(raw['towerFreq'], 'towerFreq', issues);
  if (towerFreq && !/^\d{3}\.\d{1,3}$/.test(towerFreq)) {
    issues.push(`towerFreq: "${towerFreq}" is not a frequency like "118.1"`);
  }

  // --- runways ---
  const rawRunways = Array.isArray(raw['runways']) ? raw['runways'] : [];
  if (rawRunways.length === 0) issues.push('runways: at least one runway is required');
  const runways: Runway[] = rawRunways.map((entry, i) => {
    const where = `runways[${i}]`;
    if (!isRecord(entry)) {
      issues.push(`${where}: expected an object`);
      return { id: '', thr: vec2(0, 0), course: 0, gsAngle: 3 };
    }
    return {
      id: readString(entry['id'], `${where}.id`, issues),
      thr: readPair(entry['thr'], `${where}.thr`, issues),
      course: readNumber(entry['course'], `${where}.course`, issues, { min: 0, max: 360 }),
      gsAngle: readNumber(entry['gsAngle'], `${where}.gsAngle`, issues, { min: 1, max: 6 }),
    };
  });

  // --- fixes ---
  const rawFixes = isRecord(raw['fixes']) ? raw['fixes'] : {};
  if (Object.keys(rawFixes).length === 0) issues.push('fixes: at least one fix is required');
  const fixes: Record<string, Vec2> = {};
  for (const [fixName, value] of Object.entries(rawFixes)) {
    fixes[fixName] = readPair(value, `fixes.${fixName}`, issues);
  }

  // --- stars (routes must reference known fixes) ---
  const rawStars = Array.isArray(raw['stars']) ? raw['stars'] : [];
  if (rawStars.length === 0) issues.push('stars: at least one STAR is required');
  const stars: StarProcedure[] = rawStars.map((entry, i) => {
    const where = `stars[${i}]`;
    if (!isRecord(entry)) {
      issues.push(`${where}: expected an object`);
      return { name: '', route: [], entryAlt: 0 };
    }
    const starName = readString(entry['name'], `${where}.name`, issues);
    const rawRoute = Array.isArray(entry['route']) ? entry['route'] : [];
    if (rawRoute.length === 0) issues.push(`${where}.route: at least one fix is required`);
    const route = rawRoute.map((fix, j) => {
      const fixId = readString(fix, `${where}.route[${j}]`, issues);
      if (fixId && !(fixId in fixes)) {
        issues.push(`${where}.route[${j}]: unknown fix "${fixId}"`);
      }
      return fixId;
    });
    return {
      name: starName,
      route,
      entryAlt: readNumber(entry['entryAlt'], `${where}.entryAlt`, issues, { min: 1000 }),
    };
  });

  // --- mva ---
  const rawMva = Array.isArray(raw['mva']) ? raw['mva'] : [];
  const mva: MvaSector[] = rawMva.map((entry, i) => {
    const where = `mva[${i}]`;
    if (!isRecord(entry)) {
      issues.push(`${where}: expected an object`);
      return { polygon: [], minAlt: 0 };
    }
    const rawPolygon = Array.isArray(entry['polygon']) ? entry['polygon'] : [];
    if (rawPolygon.length < 3) issues.push(`${where}.polygon: needs at least 3 points`);
    return {
      polygon: rawPolygon.map((point, j) => readPair(point, `${where}.polygon[${j}]`, issues)),
      minAlt: readNumber(entry['minAlt'], `${where}.minAlt`, issues, { min: 0 }),
    };
  });

  // --- wind ---
  const rawWind = isRecord(raw['windProfile']) ? raw['windProfile'] : {};
  const windProfile: WindProfile = {
    surface: readWindLayer(rawWind['surface'], 'windProfile.surface', issues),
    fl100: readWindLayer(rawWind['fl100'], 'windProfile.fl100', issues),
  };
  if (!isRecord(raw['windProfile'])) issues.push('windProfile: expected { surface, fl100 }');

  // --- spawn schedule (must reference known types and STARs) ---
  const starNames = new Set(stars.map((s) => s.name));
  const rawSpawn = Array.isArray(raw['spawn']) ? raw['spawn'] : [];
  const spawn: SpawnEntry[] = rawSpawn.map((entry, i) => {
    const where = `spawn[${i}]`;
    if (!isRecord(entry)) {
      issues.push(`${where}: expected an object`);
      return { t: 0, callsign: '', type: '', star: '' };
    }
    const type = readString(entry['type'], `${where}.type`, issues);
    if (type && !(type in AIRCRAFT_TYPES)) {
      issues.push(`${where}.type: unknown aircraft type "${type}"`);
    }
    const star = readString(entry['star'], `${where}.star`, issues);
    if (star && !starNames.has(star)) issues.push(`${where}.star: unknown STAR "${star}"`);
    return {
      t: readNumber(entry['t'], `${where}.t`, issues, { min: 0 }),
      callsign: readString(entry['callsign'], `${where}.callsign`, issues).toUpperCase(),
      type,
      star,
    };
  });

  const duplicates = spawn
    .map((s) => s.callsign)
    .filter((cs, i, all) => cs !== '' && all.indexOf(cs) !== i);
  for (const callsign of new Set(duplicates)) {
    issues.push(`spawn: callsign "${callsign}" is scheduled more than once`);
  }

  if (issues.length > 0) throw new AirportValidationError(issues);

  return {
    name,
    towerFreq,
    runways,
    fixes,
    stars,
    mva,
    windProfile,
    spawn: [...spawn].sort((a, b) => a.t - b.t),
  };
}

/** The bundled training sector (SPEC §13.2), validated on every call. */
export function loadTrainingWest(): Airport {
  return parseAirport(rawAirport);
}

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
  /** Fixes still to be flown; STAR aircraft navigate along these (SPEC §7). */
  route?: string[];
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
    route: [...(spec.route ?? [])],
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

/**
 * Turns a scheduled entry into a spawn: the aircraft appears over the first
 * fix of its STAR at the procedure's entry altitude, pointed at the next fix
 * (or at the threshold when the STAR has only one).
 */
export function spawnSpecFor(airport: Airport, entry: SpawnEntry): SpawnSpec | null {
  const star = findStar(airport, entry.star);
  const entryFixName = star?.route[0];
  const entryFix = entryFixName ? airport.fixes[entryFixName] : undefined;
  if (!star || !entryFix) return null;

  const nextFixName = star.route[1];
  const aimAt = (nextFixName ? airport.fixes[nextFixName] : undefined) ??
    airport.runways[0]?.thr ?? vec2(0, 0);

  return {
    callsign: entry.callsign,
    type: entry.type,
    pos: entryFix,
    altitude: star.entryAlt,
    heading: bearingTo(entryFix, aimAt),
    ias: normalSpeed(aircraftProfile(entry.type), star.entryAlt),
    star: star.name,
    route: star.route.slice(1),
    phase: 'STAR',
  };
}
