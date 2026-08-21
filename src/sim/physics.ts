/**
 * Flight physics (SPEC §5). Pure functions — one sim tick at a time.
 * The tick order defined in the SPEC is enforced by stepAircraft().
 */

import {
  DESCENT_RATE_DECEL_FACTOR,
  IAS_RATE_DESCENDING_KT_PER_S,
  IAS_RATE_LEVEL_KT_PER_S,
  MAX_TURN_RATE_DEG_PER_S,
  TAS_GAIN_PER_1000_FT,
  TURN_RATE_BANK_FACTOR,
  WIND_PROFILE_TOP_FT,
} from './constants';
import type { AircraftState, AircraftTypeProfile } from './aircraft';
import type { TurnDirection } from './commands';
import {
  add,
  angleDiff,
  bearingTo,
  clamp,
  normalizeDeg,
  polarToVec,
  scale,
  vecToPolar,
  type Vec2,
} from './geo';

export interface WindLayer {
  /** Direction the wind comes from, degrees true. */
  dir: number;
  kt: number;
}

export interface WindProfile {
  surface: WindLayer;
  fl100: WindLayer;
}

export const CALM: WindProfile = {
  surface: { dir: 0, kt: 0 },
  fl100: { dir: 0, kt: 0 },
};

/** SPEC §5.5: TAS = IAS × (1 + 0.02 × altitude/1000). */
export function iasToTas(ias: number, altitudeFt: number): number {
  return ias * (1 + TAS_GAIN_PER_1000_FT * (altitudeFt / 1000));
}

/** SPEC §5.2: rate = min(3.0, 508 / TAS) °/s — a 25° bank limit. */
export function turnRateDegPerS(tas: number): number {
  return Math.min(MAX_TURN_RATE_DEG_PER_S, TURN_RATE_BANK_FACTOR / Math.max(tas, 1));
}

/**
 * SPEC §5.2: turn towards the target heading without ever overshooting it.
 * 'L'/'R' force a direction, 'auto' takes the shorter way around.
 */
export function stepHeading(
  heading: number,
  targetHeading: number,
  turn: TurnDirection,
  tas: number,
  dt: number,
): number {
  const rightward = normalizeDeg(targetHeading - heading);
  let delta: number;
  if (rightward < 1e-9 || rightward > 360 - 1e-9) {
    delta = 0;
  } else if (turn === 'auto') {
    delta = angleDiff(heading, targetHeading);
  } else {
    delta = turn === 'R' ? rightward : rightward - 360;
  }

  const step = turnRateDegPerS(tas) * dt;
  if (Math.abs(delta) <= step) return normalizeDeg(targetHeading);
  return normalizeDeg(heading + Math.sign(delta) * step);
}

/** SPEC §5.3: ±1.0 kt/s level, 0.5 kt/s while slowing down in a descent. */
export function stepIas(ias: number, targetIas: number, descending: boolean, dt: number): number {
  const delta = targetIas - ias;
  const rate =
    descending && delta < 0 ? IAS_RATE_DESCENDING_KT_PER_S : IAS_RATE_LEVEL_KT_PER_S;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return targetIas;
  return ias + Math.sign(delta) * step;
}

/**
 * SPEC §5.4: climb/descend at the type rate; a descent flown while
 * decelerating only achieves 60 % of the nominal rate.
 * Returns the new altitude and the vertical speed actually flown (ft/min).
 */
export function stepAltitude(
  altitude: number,
  targetAltitude: number,
  profile: AircraftTypeProfile,
  decelerating: boolean,
  dt: number,
): { altitude: number; vs: number } {
  const delta = targetAltitude - altitude;
  if (delta === 0) return { altitude, vs: 0 };

  const climbing = delta > 0;
  let ratePerMin = climbing ? profile.climbRate : profile.descentRate;
  if (!climbing && decelerating) ratePerMin *= DESCENT_RATE_DECEL_FACTOR;

  const step = (ratePerMin / 60) * dt;
  if (Math.abs(delta) <= step) {
    return { altitude: targetAltitude, vs: (delta / dt) * 60 };
  }
  const change = Math.sign(delta) * step;
  return { altitude: altitude + change, vs: (change / dt) * 60 };
}

/** SPEC §5.5: linear between surface and FL100, constant above. */
export function windAt(profile: WindProfile, altitudeFt: number): WindLayer {
  const t = clamp(altitudeFt / WIND_PROFILE_TOP_FT, 0, 1);
  const { surface, fl100 } = profile;
  return {
    dir: normalizeDeg(surface.dir + angleDiff(surface.dir, fl100.dir) * t),
    kt: surface.kt + (fl100.kt - surface.kt) * t,
  };
}

/** The vector the air mass moves along (wind dir is where it blows *from*). */
export function windVector(layer: WindLayer): Vec2 {
  return polarToVec(layer.dir + 180, layer.kt);
}

/** SPEC §5.5: ground vector = TAS vector + wind vector. */
export function groundVector(
  heading: number,
  tas: number,
  wind: WindLayer,
): { track: number; gs: number } {
  const ground = add(polarToVec(heading, tas), windVector(wind));
  const { bearing, magnitude } = vecToPolar(ground);
  return { track: tas === 0 && wind.kt === 0 ? heading : bearing, gs: magnitude };
}

/** SPEC §5.6: integrate position from ground track and ground speed. */
export function integratePosition(pos: Vec2, track: number, gs: number, dt: number): Vec2 {
  const nmPerSecond = gs / 3600;
  return add(pos, scale(polarToVec(track, 1), nmPerSecond * dt));
}

/**
 * One physics tick for one aircraft, in the order mandated by SPEC §5
 * (steps 2–6; the pilot queue and the FSM are driven by the caller).
 */
export function stepAircraft(
  ac: AircraftState,
  profile: AircraftTypeProfile,
  wind: WindProfile,
  fixes: Readonly<Record<string, Vec2>>,
  dt: number,
): void {
  // A 'direct' clearance keeps re-aiming the target heading at the fix.
  if (ac.target.directTo) {
    const fix = fixes[ac.target.directTo];
    if (fix) ac.target.heading = { deg: bearingTo(ac.pos, fix), turn: 'auto' };
  }

  // Flags are read before any state changes so both steps see the same tick.
  const descending = ac.target.altitude < ac.altitude;
  const decelerating = ac.target.speed < ac.ias;

  if (ac.target.heading) {
    ac.heading = stepHeading(ac.heading, ac.target.heading.deg, ac.target.heading.turn, ac.tas, dt);
  }
  ac.ias = stepIas(ac.ias, ac.target.speed, descending, dt);

  const vertical = stepAltitude(ac.altitude, ac.target.altitude, profile, decelerating, dt);
  ac.altitude = vertical.altitude;
  ac.vs = vertical.vs;

  ac.tas = iasToTas(ac.ias, ac.altitude);
  const ground = groundVector(ac.heading, ac.tas, windAt(wind, ac.altitude));
  ac.track = ground.track;
  ac.gs = ground.gs;
  ac.pos = integratePosition(ac.pos, ac.track, ac.gs, dt);
}
