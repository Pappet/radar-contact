/**
 * Pilot model (SPEC §6): reaction delay, readback, execution and refusals.
 */

import { aircraftProfile, normalSpeed, type AircraftState, type AircraftTypeProfile } from './aircraft';
import { canHandOff } from './approach';
import type { Command } from './commands';
import {
  PILOT_DELAY_MAX_S,
  PILOT_DELAY_MEAN_S,
  PILOT_DELAY_MIN_S,
  PILOT_DELAY_SIGMA_S,
  SPEED_RESTRICTION_ALT_FT,
  SPEED_RESTRICTION_IAS_KT,
} from './constants';
import { emit } from './events';
import { clamp } from './geo';
import { phaseAfterCommand } from './phases';
import { pilotReadback, pilotUnable } from '../phraseology';
import { randomNormal } from './rng';
import { towerFrequency, type SimState } from './state';

/** SPEC §6: N(3.5, 1) seconds of sim time, clamped to [2, 6]. */
export function pilotDelaySeconds(state: SimState): number {
  return clamp(
    randomNormal(state, PILOT_DELAY_MEAN_S, PILOT_DELAY_SIGMA_S),
    PILOT_DELAY_MIN_S,
    PILOT_DELAY_MAX_S,
  );
}

/**
 * SPEC §5: reasons a pilot refuses a clearance. Returns null when acceptable.
 * An altitude below the MVA is *not* refused — that is a controller error.
 */
export function rejectionReason(
  state: SimState,
  ac: AircraftState,
  cmd: Command,
  profile: AircraftTypeProfile,
): string | null {
  // SPEC §7: the tower only takes an aircraft that is established and close in.
  if (cmd.kind === 'handoff' && !canHandOff(state, ac)) return 'not established';

  if (cmd.kind === 'ils' && !state.airport?.runways.some((r) => r.id === cmd.runway)) {
    return `no runway ${cmd.runway}`;
  }

  if (cmd.kind !== 'speed' || cmd.kt === 'normal') return null;
  if (ac.altitude < SPEED_RESTRICTION_ALT_FT && cmd.kt > SPEED_RESTRICTION_IAS_KT) {
    return 'speed restriction';
  }
  if (cmd.kt < profile.vMin || cmd.kt > profile.vMax) return 'aircraft performance';
  return null;
}

/** Turns one accepted command into aircraft targets (SPEC §5.1, §7). */
export function applyCommand(
  ac: AircraftState,
  cmd: Command,
  profile: AircraftTypeProfile,
): void {
  ac.phase = phaseAfterCommand(ac.phase, cmd);

  switch (cmd.kind) {
    case 'heading':
      ac.target.heading = { deg: cmd.deg, turn: cmd.turn };
      delete ac.target.directTo;
      break;
    case 'altitude':
      ac.target.altitude = cmd.ft;
      break;
    case 'speed':
      ac.target.speed = cmd.kt === 'normal' ? normalSpeed(profile, ac.altitude) : cmd.kt;
      break;
    case 'squawk':
      ac.squawk = cmd.code;
      break;
    case 'ils':
      // SPEC §7: the aircraft keeps its current targets until it captures.
      ac.clearedIls = cmd.runway;
      ac.phase = 'CLEARED_ILS';
      break;
    case 'handoff':
      // SPEC §7: it flies on and leaves the sector at one mile.
      ac.phase = 'HANDOFF';
      break;
    case 'direct':
    case 'hold':
      // Navigation clearances arrive with M4 (SPEC §14).
      break;
  }
}

/**
 * SPEC §6: due queue entries produce the readback (or a refusal) and become
 * targets. Called once per aircraft per tick, before the physics.
 */
export function processPilotQueue(state: SimState, ac: AircraftState): void {
  if (ac.pilot.queue.length === 0) return;

  const due = ac.pilot.queue.filter((entry) => entry.executeAt <= state.time);
  if (due.length === 0) return;
  ac.pilot.queue = ac.pilot.queue.filter((entry) => entry.executeAt > state.time);

  const profile = aircraftProfile(ac.type);

  for (const entry of due) {
    const accepted: Command[] = [];
    const refusals: string[] = [];

    for (const cmd of entry.cmds) {
      const reason = rejectionReason(state, ac, cmd, profile);
      if (reason) {
        if (!refusals.includes(reason)) refusals.push(reason);
      } else {
        accepted.push(cmd);
      }
    }

    if (accepted.length > 0) {
      emit(state, {
        kind: 'transmission',
        from: 'pilot',
        callsign: ac.callsign,
        text: pilotReadback(accepted, {
          callsign: ac.callsign,
          altitude: ac.altitude,
          ias: ac.ias,
          towerFreq: towerFrequency(state),
        }),
      });
      for (const cmd of accepted) applyCommand(ac, cmd, profile);
    }

    for (const reason of refusals) {
      emit(state, {
        kind: 'transmission',
        from: 'pilot',
        callsign: ac.callsign,
        text: pilotUnable(reason, ac.callsign),
      });
    }
  }
}
