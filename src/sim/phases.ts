/**
 * Flight phase state machine (SPEC §7).
 * M2 covers STAR navigation; the ILS phases land in M3.
 */

import type { AircraftState } from './aircraft';
import type { Command } from './commands';
import { FIX_CAPTURE_RADIUS_NM } from './constants';
import { distanceNm, type Vec2 } from './geo';

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
 * SPEC §7: any heading, direct or holding clearance takes an aircraft off its
 * STAR and puts it under radar vectors.
 */
export function phaseAfterCommand(phase: Phase, cmd: Command): Phase {
  if (
    phase === 'STAR' &&
    (cmd.kind === 'heading' || cmd.kind === 'direct' || cmd.kind === 'hold')
  ) {
    return 'VECTOR';
  }
  return phase;
}

/**
 * SPEC §7: an aircraft on its STAR steers at the next fix of the route and
 * moves on once it is within the capture radius. After the last fix it simply
 * holds its heading until the controller takes over.
 */
export function updateStarNavigation(
  ac: AircraftState,
  fixes: Readonly<Record<string, Vec2>>,
): void {
  if (ac.phase !== 'STAR') return;

  // Skip fixes the airport does not know — validation keeps this from firing.
  while (ac.route.length > 0 && !fixes[ac.route[0] as string]) ac.route.shift();

  const next = ac.route[0];
  if (!next) {
    delete ac.target.directTo;
    return;
  }

  ac.target.directTo = next;
  const fix = fixes[next];
  if (fix && distanceNm(ac.pos, fix) <= FIX_CAPTURE_RADIUS_NM) ac.route.shift();
}
