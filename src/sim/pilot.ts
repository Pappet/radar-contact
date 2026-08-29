/**
 * Pilot model (SPEC §6): reaction delay, readback, execution and refusals.
 */

import { aircraftProfile, normalSpeed, type AircraftState, type AircraftTypeProfile } from './aircraft';
import { canHandOff } from './approach';
import type { Command } from './commands';
import {
  HEARBACK_ALTITUDE_ERROR_FT,
  HEARBACK_HEADING_ERROR_DEG,
  PILOT_DELAY_MAX_S,
  PILOT_DELAY_MEAN_S,
  PILOT_DELAY_MIN_S,
  PILOT_DELAY_SIGMA_S,
  SPEED_RESTRICTION_ALT_FT,
  SPEED_RESTRICTION_IAS_KT,
} from './constants';
import { emit } from './events';
import { applyHoldClearance, cancelHolding } from './holding';
import { clamp, normalizeDeg } from './geo';
import { phaseAfterCommand, type Phase } from './phases';
import { pilotReadback, pilotUnable } from '../phraseology';
import { nextRandom, randomInt, randomNormal } from './rng';
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

  // Navigation clearances aim at a fix — an unknown one cannot be flown.
  if ((cmd.kind === 'direct' || cmd.kind === 'hold') && !state.airport?.fixes[cmd.fix]) {
    return 'unknown fix';
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
      cancelHolding(ac);
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
      cancelHolding(ac);
      ac.clearedIls = cmd.runway;
      ac.phase = 'CLEARED_ILS';
      break;
    case 'handoff':
      // SPEC §7: it flies on and leaves the sector at one mile.
      ac.phase = 'HANDOFF';
      break;
    case 'direct':
      // Steers at the fix every tick from now on (SPEC §5.2); the hold and
      // any approach clearance are replaced by it.
      cancelHolding(ac);
      if (isApproachPhase(ac.phase)) {
        delete ac.clearedIls;
        ac.phase = 'VECTOR';
      }
      ac.target.directTo = cmd.fix;
      break;
    case 'hold':
      // Racetrack at the fix (SPEC §14 M4); replaces the approach clearance.
      applyHoldClearance(ac, cmd.fix);
      break;
  }
}

const APPROACH_PHASES: Phase[] = ['CLEARED_ILS', 'LOC', 'GS'];

function isApproachPhase(phase: Phase): boolean {
  return APPROACH_PHASES.includes(phase);
}

/**
 * SPEC §6 (M4): with the configured chance per transmission the pilot
 * mishears exactly one numeric value — an altitude by ±1000 ft or a heading
 * by ±10°. The wrong number is both read back and executed, so a wrong
 * readback is the controller's cue; a corrective re-clearance fixes it.
 * Transmissions without a numeric value cannot be misheard.
 */
export function applyHearbackError(state: SimState, accepted: Command[]): Command[] {
  // Rate 0 must stay RNG-neutral: no roll, no draw, so seeds replay exactly
  // as they did before the hearback feature existed.
  if (state.hearbackErrorRate <= 0) return accepted;
  if (nextRandom(state) >= state.hearbackErrorRate) return accepted;

  const numeric = accepted
    .map((cmd, index) => ({ cmd, index }))
    .filter(({ cmd }) => cmd.kind === 'heading' || cmd.kind === 'altitude');
  if (numeric.length === 0) return accepted;

  const misheard = numeric[randomInt(state, 0, numeric.length - 1)];
  if (!misheard) return accepted;
  const sign = randomInt(state, 0, 1) === 0 ? -1 : 1;

  return accepted.map((cmd, index) => {
    if (index !== misheard.index) return cmd;
    if (cmd.kind === 'heading') {
      return { ...cmd, deg: normalizeDeg(cmd.deg + sign * HEARBACK_HEADING_ERROR_DEG) };
    }
    if (cmd.kind === 'altitude') {
      return { ...cmd, ft: Math.max(0, cmd.ft + sign * HEARBACK_ALTITUDE_ERROR_FT) };
    }
    return cmd;
  });
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
    // A new transmission supersedes whatever the pilot misheard last time.
    delete ac.pilot.hearbackTaken;

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
      // SPEC §6: the hearback roll happens once per transmission, before the
      // readback — the wrong number is heard, read back *and* executed.
      const heard = applyHearbackError(state, accepted);
      if (heard !== accepted) ac.pilot.hearbackTaken = heard;

      emit(state, {
        kind: 'transmission',
        from: 'pilot',
        callsign: ac.callsign,
        text: pilotReadback(heard, {
          callsign: ac.callsign,
          altitude: ac.altitude,
          ias: ac.ias,
          towerFreq: towerFrequency(state),
        }),
      });
      for (const cmd of heard) applyCommand(ac, cmd, profile);
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
