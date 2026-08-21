/**
 * The command union (SPEC §4) and the one and only way into the simulation
 * (SPEC invariant: click UI and console both end up here).
 */

import type { SimState } from './state';
import { findAircraft } from './state';
import { emit } from './events';
import { pilotDelaySeconds } from './pilot';
import { atcTransmission } from '../phraseology';

export type TurnDirection = 'L' | 'R' | 'auto';

export type Command =
  | { kind: 'heading'; deg: number; turn: TurnDirection }
  | { kind: 'altitude'; ft: number }
  | { kind: 'speed'; kt: number | 'normal' }
  | { kind: 'direct'; fix: string }
  | { kind: 'ils'; runway: string }
  | { kind: 'hold'; fix: string }
  | { kind: 'handoff' }
  | { kind: 'squawk'; code: string };

export type DispatchResult =
  | { ok: true; callsign: string }
  | { ok: false; reason: 'unknown-callsign' | 'no-commands' };

/**
 * Transmit a clearance. The ATC transmission is heard at once; the pilot reads
 * back and acts on it after the reaction delay (SPEC §6).
 */
export function dispatch(state: SimState, callsign: string, commands: Command[]): DispatchResult {
  if (commands.length === 0) return { ok: false, reason: 'no-commands' };

  const ac = findAircraft(state, callsign);
  if (!ac || !ac.onFrequency || ac.phase === 'DONE') {
    return { ok: false, reason: 'unknown-callsign' };
  }

  emit(state, {
    kind: 'transmission',
    from: 'atc',
    callsign: ac.callsign,
    text: atcTransmission(commands, {
      callsign: ac.callsign,
      altitude: ac.altitude,
      ias: ac.ias,
      towerFreq: state.towerFreq,
    }),
  });

  ac.pilot.queue.push({
    cmds: commands,
    executeAt: state.time + pilotDelaySeconds(state),
  });

  return { ok: true, callsign: ac.callsign };
}
