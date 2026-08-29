/**
 * ILS approach, go-around and handoff (SPEC §7).
 *
 * The geometry is pure and separately testable; updateApproach() drives the
 * phases CLEARED_ILS → LOC → GS → HANDOFF and the go-arounds.
 */

import type { AircraftState } from './aircraft';
import { aircraftProfile } from './aircraft';
import {
  APPROACH_GATE_NM,
  FINAL_SPEED_NM,
  GATE_MAX_ABOVE_FT,
  GLIDEPATH_FT_PER_NM,
  GS_CAPTURE_BAND_FT,
  HANDOFF_MAX_NM,
  LOC_CAPTURE_ANGLE_DEG,
  LOC_CAPTURE_LATERAL_NM,
  LOC_CORRECTION_DEG_PER_NM,
  LOC_CORRECTION_MAX_DEG,
  MISSED_APPROACH_ALT_FT,
  SPACING_CHECK_NM,
  TICK_SECONDS,
  TOUCHDOWN_NM,
} from './constants';
import { emit } from './events';
import { angleDiff, clamp, normalizeDeg, polarToVec, sub, type Vec2 } from './geo';
import { headingForTrack, windAt } from './physics';
import { wakeMinInTrailNm } from './separation';
import type { Runway } from './scenario';
import type { SimState } from './state';
import { pilotGoingAround } from '../phraseology';

export interface ApproachGeometry {
  /** Distance from the threshold along the approach course, NM.
   *  Positive on the approach side, negative once past the threshold. */
  distance: number;
  /** Offset from the extended centerline, NM. Positive = left of the
   *  inbound course, because the across axis points to the left. */
  lateral: number;
  /** Height of the 3° glidepath at this distance, ft. */
  glidepath: number;
}

/** Height of the glidepath at a distance from the threshold (SPEC §7). */
export function glidepathAt(distanceNm: number): number {
  return Math.max(0, GLIDEPATH_FT_PER_NM * distanceNm);
}

/** Where an aircraft sits relative to the final approach course. */
export function approachGeometry(pos: Vec2, runway: Runway): ApproachGeometry {
  const fromThreshold = sub(pos, runway.thr);
  // Aircraft arrive on the reciprocal of the landing course.
  const outbound = polarToVec(runway.course + 180, 1);
  const across = polarToVec(runway.course + 270, 1);

  const distance = fromThreshold.x * outbound.x + fromThreshold.y * outbound.y;
  const lateral = fromThreshold.x * across.x + fromThreshold.y * across.y;

  return { distance, lateral, glidepath: glidepathAt(distance) };
}

/** SPEC §7: within half a mile of the centerline and cutting it at 30° or less. */
export function canCaptureLocalizer(ac: AircraftState, runway: Runway): boolean {
  const { distance, lateral } = approachGeometry(ac.pos, runway);
  if (distance <= 0) return false; // already past the threshold
  const intercept = Math.abs(angleDiff(ac.track, runway.course));
  return Math.abs(lateral) <= LOC_CAPTURE_LATERAL_NM && intercept <= LOC_CAPTURE_ANGLE_DEG;
}

/**
 * SPEC §7: the glidepath is only joined from below — either the aircraft is
 * level and the path descends onto it, or it is climbing towards it. An
 * aircraft diving through the path from above does not capture.
 */
export function canCaptureGlidepath(
  ac: AircraftState,
  runway: Runway,
  groundSpeedKt = ac.gs,
): boolean {
  const { distance, glidepath } = approachGeometry(ac.pos, runway);
  if (distance <= 0) return false;

  const below = glidepath - ac.altitude;
  if (below < 0 || below > GS_CAPTURE_BAND_FT) return false;

  // How fast the path itself sinks towards the aircraft, ft per second.
  const pathSinkPerSecond = (GLIDEPATH_FT_PER_NM * groundSpeedKt) / 3600;
  const aircraftSinkPerSecond = -ac.vs / 60;
  return aircraftSinkPerSecond < pathSinkPerSecond;
}

/** The aircraft ahead on the same final, if there is one. */
export function precedingOnFinal(
  ac: AircraftState,
  all: AircraftState[],
  runway: Runway,
): { other: AircraftState; gap: number } | null {
  const own = approachGeometry(ac.pos, runway).distance;
  let best: { other: AircraftState; gap: number } | null = null;

  for (const other of all) {
    if (other.id === ac.id) continue;
    if (other.phase !== 'LOC' && other.phase !== 'GS' && other.phase !== 'HANDOFF') continue;
    const theirs = approachGeometry(other.pos, runway).distance;
    if (theirs <= 0 || theirs >= own) continue; // must be ahead
    const gap = own - theirs;
    if (!best || gap < best.gap) best = { other, gap };
  }
  return best;
}

function activeRunway(state: SimState, ac: AircraftState): Runway | undefined {
  const runways = state.airport?.runways ?? [];
  return ac.clearedIls ? runways.find((r) => r.id === ac.clearedIls) : runways[0];
}

function goAround(state: SimState, ac: AircraftState, reason: 'notEstablished' | 'tooHigh' | 'spacing'): void {
  ac.phase = 'GOAROUND';
  delete ac.clearedIls;
  delete ac.target.directTo;
  ac.target.heading = { deg: ac.heading, turn: 'auto' };
  ac.target.altitude = MISSED_APPROACH_ALT_FT;
  ac.target.speed = aircraftProfile(ac.type).vMin + 20;
  emit(state, { kind: 'goAround', callsign: ac.callsign, reason });
  emit(state, {
    kind: 'transmission',
    from: 'pilot',
    callsign: ac.callsign,
    text: pilotGoingAround(ac.callsign),
  });
}

/** Leaves the sector: handed over cleanly, or landed without a handoff. */
function complete(state: SimState, ac: AircraftState, handedOff: boolean): void {
  ac.phase = 'DONE';
  ac.onFrequency = false;
  state.completed.push({
    callsign: ac.callsign,
    handedOff,
    at: state.time,
    timeInSector: state.time - ac.spawnedAt,
  });
  if (handedOff) emit(state, { kind: 'handoffComplete', callsign: ac.callsign });
}

/**
 * One tick of approach logic, run before the physics so the targets it sets
 * take effect in the same second.
 */
export function updateApproach(state: SimState, ac: AircraftState): void {
  if (ac.phase === 'GOAROUND') {
    // SPEC §7: straight ahead up to 4000 ft, then the controller takes over.
    if (ac.altitude >= MISSED_APPROACH_ALT_FT) ac.phase = 'VECTOR';
    return;
  }

  const onApproach =
    ac.phase === 'CLEARED_ILS' || ac.phase === 'LOC' || ac.phase === 'GS' || ac.phase === 'HANDOFF';
  if (!onApproach) return;

  const runway = activeRunway(state, ac);
  if (!runway) return;

  const geometry = approachGeometry(ac.pos, runway);

  // Leaving the sector at one mile, handed over or not (SPEC §7).
  if (geometry.distance <= TOUCHDOWN_NM) {
    complete(state, ac, ac.phase === 'HANDOFF');
    return;
  }

  if (ac.phase === 'CLEARED_ILS' && canCaptureLocalizer(ac, runway)) {
    ac.phase = 'LOC';
    delete ac.target.directTo;
  }

  const established = ac.phase === 'LOC' || ac.phase === 'GS' || ac.phase === 'HANDOFF';

  // SPEC §7: one look at six miles decides notEstablished and tooHigh.
  if (!ac.gateChecked && geometry.distance <= APPROACH_GATE_NM) {
    ac.gateChecked = true;
    if (!established) {
      goAround(state, ac, 'notEstablished');
      return;
    }
    if (ac.altitude > geometry.glidepath + GATE_MAX_ABOVE_FT) {
      goAround(state, ac, 'tooHigh');
      return;
    }
  }

  if (!established) return;

  // SPEC §7/§8: spacing to the aircraft ahead is judged from four miles
  // inwards, against the wake turbulence minimum for the pair (M4).
  if (geometry.distance <= SPACING_CHECK_NM) {
    const ahead = precedingOnFinal(ac, state.aircraft, runway);
    if (ahead && ahead.gap < wakeMinInTrailNm(ahead.other.wake, ac.wake)) {
      goAround(state, ac, 'spacing');
      return;
    }
  }

  // Track the centerline: aim slightly across it to work off any offset,
  // then crab so that the *track* — not the heading — follows the course.
  const correction = clamp(
    geometry.lateral * LOC_CORRECTION_DEG_PER_NM,
    -LOC_CORRECTION_MAX_DEG,
    LOC_CORRECTION_MAX_DEG,
  );
  const desiredTrack = normalizeDeg(runway.course + correction);
  ac.target.heading = {
    deg: headingForTrack(desiredTrack, ac.tas, windAt(state.wind, ac.altitude)),
    turn: 'auto',
  };

  if (ac.phase === 'LOC' && canCaptureGlidepath(ac, runway)) ac.phase = 'GS';

  if (ac.phase === 'GS' || ac.phase === 'HANDOFF') {
    // Aim at the glidepath height one tick ahead, so the descent leads rather
    // than lags behind the path.
    const ahead = Math.max(0, geometry.distance - (ac.gs / 3600) * TICK_SECONDS);
    ac.target.altitude = glidepathAt(ahead);

    // SPEC §7: the pilot slows down by himself once on the path, so that he
    // is at final approach speed by five miles at the latest — starting only
    // at five miles would leave 60 kt to lose in two minutes of flying.
    const { vApp } = aircraftProfile(ac.type);
    if (ac.phase === 'GS' || geometry.distance <= FINAL_SPEED_NM) ac.target.speed = vApp;
  }
}

/** SPEC §7: a handoff needs an established aircraft inside ten miles. */
export function canHandOff(state: SimState, ac: AircraftState): boolean {
  if (ac.phase !== 'LOC' && ac.phase !== 'GS') return false;
  const runway = activeRunway(state, ac);
  if (!runway) return false;
  const { distance } = approachGeometry(ac.pos, runway);
  return distance > 0 && distance <= HANDOFF_MAX_NM;
}
