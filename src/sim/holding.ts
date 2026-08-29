/**
 * Published holding at a fix (SPEC §4, §14 M4): a racetrack flown with right
 * turns and one-minute legs.
 *
 * v1 simplification: the outbound leg runs for exactly one minute as a
 * wind-corrected *track* (the crab is flown like on the localizer), while the
 * inbound leg steers at the fix and ends when the fix is crossed. That way
 * every circuit re-centres the pattern instead of letting drift walk it away
 * from the fix. Both turns into and out of the outbound leg are right turns.
 *
 * Pure per-tick logic like updateApproach(): it only sets targets — the
 * physics in stepAircraft() does the flying.
 */

import type { AircraftState } from './aircraft';
import {
  FIX_CAPTURE_RADIUS_NM,
  HOLD_OUTBOUND_LEG_S,
  HOLD_ROLLOUT_TOLERANCE_DEG,
} from './constants';
import { distanceNm, normalizeDeg, type Vec2 } from './geo';
import { headingForTrack, windAt, type WindProfile } from './physics';

/** Enters the hold: proceed to the fix first, then racetrack. */
export function applyHoldClearance(ac: AircraftState, fix: string): void {
  ac.holding = { fix, leg: 'entry', inboundTrack: 0, legSeconds: 0 };
  ac.target.directTo = fix;
  // A holding clearance replaces whatever approach clearance was running.
  delete ac.clearedIls;
  ac.phase = 'VECTOR';
}

/** Any navigation clearance ends the hold; altitude and speed do not. */
export function cancelHolding(ac: AircraftState): void {
  delete ac.holding;
}

/** Remaining rightward sweep onto a target heading, in degrees. */
function rightwardTo(ac: AircraftState, targetDeg: number): number {
  return normalizeDeg(targetDeg - ac.heading);
}

/**
 * One tick of holding logic, run before the physics so the targets it sets
 * take effect in the same second. No-op for aircraft that are not holding.
 */
export function updateHolding(
  ac: AircraftState,
  fixes: Readonly<Record<string, Vec2>>,
  wind: WindProfile,
  dt: number,
): void {
  const holding = ac.holding;
  if (!holding) return;

  const fix = fixes[holding.fix];

  // Into the fix: steer at it and cross it (SPEC §7 fix capture radius).
  if (holding.leg === 'entry' || holding.leg === 'inbound') {
    if (!fix) return; // validation keeps unknown fixes from getting this far
    ac.target.directTo = holding.fix;
    if (distanceNm(ac.pos, fix) <= FIX_CAPTURE_RADIUS_NM) {
      // Crossing the fix: note the inbound track and turn right onto the
      // outbound leg, which flies the reciprocal track.
      holding.inboundTrack = normalizeDeg(ac.track);
      holding.leg = 'turnOut';
      holding.legSeconds = 0;
      delete ac.target.directTo;
    }
    return;
  }

  const outboundTrack = normalizeDeg(holding.inboundTrack + 180);
  const crabbed = (track: number): number =>
    headingForTrack(track, ac.tas, windAt(wind, ac.altitude));

  // Right turn from the fix onto the outbound track.
  if (holding.leg === 'turnOut') {
    const target = crabbed(outboundTrack);
    ac.target.heading = { deg: target, turn: 'R' };
    if (rightwardTo(ac, target) <= HOLD_ROLLOUT_TOLERANCE_DEG) {
      holding.leg = 'outbound';
      holding.legSeconds = 0;
    }
    return;
  }

  // The outbound leg: one minute, flown as a wind-corrected track.
  if (holding.leg === 'outbound') {
    ac.target.heading = { deg: crabbed(outboundTrack), turn: 'auto' };
    holding.legSeconds += dt;
    if (holding.legSeconds >= HOLD_OUTBOUND_LEG_S) holding.leg = 'turnIn';
    return;
  }

  // Right turn back onto the inbound: a full 180° onto the reciprocal track.
  // The inbound leg then steers at the fix and soaks up whatever offset the
  // turns and the wind have left behind.
  const inboundTarget = crabbed(holding.inboundTrack);
  ac.target.heading = { deg: inboundTarget, turn: 'R' };
  if (rightwardTo(ac, inboundTarget) <= HOLD_ROLLOUT_TOLERANCE_DEG) {
    holding.leg = 'inbound';
    holding.legSeconds = 0;
    delete ac.target.heading;
  }
}
