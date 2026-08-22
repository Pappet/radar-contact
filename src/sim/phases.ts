/**
 * Flight phase state machine (SPEC §7).
 * M1 only needs the STAR → VECTOR transition; the ILS phases land in M3.
 */

import type { Command } from './commands';

export type Phase =
  | 'STAR'
  | 'VECTOR'
  | 'CLEARED_ILS'
  | 'LOC'
  | 'GS'
  | 'HANDOFF'
  | 'GOAROUND'
  | 'DONE';

/**
 * SPEC §7: any heading or direct clearance takes an aircraft off its STAR
 * and puts it under radar vectors.
 */
export function phaseAfterCommand(phase: Phase, cmd: Command): Phase {
  if (phase === 'STAR' && (cmd.kind === 'heading' || cmd.kind === 'direct')) return 'VECTOR';
  return phase;
}
