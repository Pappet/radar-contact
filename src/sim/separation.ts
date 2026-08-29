/**
 * Separation, STCA and MVA (SPEC §8). Pure predicates over aircraft state —
 * the tick decides when to run them and which events to raise.
 */

import type { AircraftState, WakeCategory } from './aircraft';
import {
  MVA_BUFFER_FT,
  SEPARATION_CEILING_FT,
  SEPARATION_HORIZONTAL_NM,
  SEPARATION_VERTICAL_FT,
  STCA_LOOKAHEAD_S,
  STCA_STEP_S,
  WAKE_IN_TRAIL_NM,
} from './constants';
import { distanceNm, polarToVec, type Vec2 } from './geo';
import type { MvaSector } from './scenario';

export interface Pair {
  a: string;
  b: string;
}

/**
 * SPEC §8: the wake turbulence radar spacing minimum behind a leader, flown
 * by a follower of the given category. Behind heavy: heavy 4 / medium 5 /
 * light 6 NM; a light behind a medium: 5 NM; everything else: 3 NM.
 */
export function wakeMinInTrailNm(leader: WakeCategory, follower: WakeCategory): number {
  return WAKE_IN_TRAIL_NM[leader][follower];
}

/** Order-independent key, so a pair debounces as one thing. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * SPEC §8: only aircraft below 15 000 ft that are still in the sector take
 * part in separation monitoring.
 */
export function isSeparationRelevant(ac: AircraftState): boolean {
  return ac.phase !== 'DONE' && ac.altitude < SEPARATION_CEILING_FT;
}

/** Both minima breached at once is a loss; either one alone is not. */
export function isConflict(a: AircraftState, b: AircraftState): boolean {
  return (
    distanceNm(a.pos, b.pos) < SEPARATION_HORIZONTAL_NM &&
    Math.abs(a.altitude - b.altitude) < SEPARATION_VERTICAL_FT
  );
}

/** Every relevant pair that is currently in a separation loss. */
export function findConflicts(aircraft: AircraftState[]): Pair[] {
  const watched = aircraft.filter(isSeparationRelevant);
  const conflicts: Pair[] = [];

  for (let i = 0; i < watched.length; i += 1) {
    for (let j = i + 1; j < watched.length; j += 1) {
      const a = watched[i];
      const b = watched[j];
      if (a && b && isConflict(a, b)) conflicts.push({ a: a.callsign, b: b.callsign });
    }
  }
  return conflicts;
}

/** Where an aircraft would be in `seconds`, flying its current track and VS. */
export function extrapolate(
  ac: AircraftState,
  seconds: number,
): { pos: Vec2; altitude: number } {
  const nm = (ac.gs / 3600) * seconds;
  const step = polarToVec(ac.track, nm);
  return {
    pos: { x: ac.pos.x + step.x, y: ac.pos.y + step.y },
    altitude: ac.altitude + (ac.vs / 60) * seconds,
  };
}

/**
 * SPEC §8: linear extrapolation up to 120 s ahead in 4 s steps. True as soon
 * as any step is predicted below both minima. t = 0 counts too, so an existing
 * loss also raises the alert.
 */
export function predictsConflict(
  a: AircraftState,
  b: AircraftState,
  lookahead = STCA_LOOKAHEAD_S,
  step = STCA_STEP_S,
): boolean {
  for (let t = 0; t <= lookahead; t += step) {
    const pa = extrapolate(a, t);
    const pb = extrapolate(b, t);
    if (
      distanceNm(pa.pos, pb.pos) < SEPARATION_HORIZONTAL_NM &&
      Math.abs(pa.altitude - pb.altitude) < SEPARATION_VERTICAL_FT
    ) {
      return true;
    }
  }
  return false;
}

/** Every relevant pair whose predicted tracks come too close. */
export function findStcaPairs(aircraft: AircraftState[]): Pair[] {
  const watched = aircraft.filter(isSeparationRelevant);
  const pairs: Pair[] = [];

  for (let i = 0; i < watched.length; i += 1) {
    for (let j = i + 1; j < watched.length; j += 1) {
      const a = watched[i];
      const b = watched[j];
      if (a && b && predictsConflict(a, b)) pairs.push({ a: a.callsign, b: b.callsign });
    }
  }
  return pairs;
}

/**
 * Ray casting. Points exactly on an edge are not guaranteed either way — MVA
 * sectors are far larger than that ambiguity.
 */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const straddles = pi.y > point.y !== pj.y > point.y;
    if (!straddles) continue;
    const crossingX = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/**
 * SPEC §13: overlapping sectors take the highest minimum.
 * Returns null outside every sector.
 */
export function mvaAt(sectors: MvaSector[], point: Vec2): number | null {
  let highest: number | null = null;
  for (const sector of sectors) {
    if (!pointInPolygon(point, sector.polygon)) continue;
    if (highest === null || sector.minAlt > highest) highest = sector.minAlt;
  }
  return highest;
}

/**
 * SPEC §8: below the sector minimum minus the buffer. Aircraft established on
 * the approach are exempt — the glideslope takes them below the MVA by design.
 */
export function violatesMva(ac: AircraftState, sectors: MvaSector[]): boolean {
  if (ac.phase === 'DONE' || ac.phase === 'LOC' || ac.phase === 'GS') return false;
  const minimum = mvaAt(sectors, ac.pos);
  return minimum !== null && ac.altitude < minimum - MVA_BUFFER_FT;
}
