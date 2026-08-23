/**
 * Score and session summary (SPEC §11.5). Pure: it reads the event log and
 * the completed flights and works out what the session was worth.
 */

import {
  SCORE_GO_AROUND,
  SCORE_HANDOFF,
  SCORE_MVA_VIOLATION,
  SCORE_SEPARATION_LOSS,
} from './sim/constants';
import type { SimEventRecord } from './sim/events';
import type { CompletedFlight } from './sim/state';

export interface SessionSummary {
  score: number;
  handoffs: number;
  /** Landed without ever being handed to the tower: worth nothing (SPEC §11.5). */
  landedWithoutHandoff: number;
  separationLosses: number;
  mvaViolations: number;
  goArounds: number;
  /** Seconds, averaged over completed flights only; null when there were none. */
  averageTimeInSector: number | null;
  /** Flights still airborne when the session ended. */
  stillAirborne: number;
}

export function summarize(
  records: SimEventRecord[],
  completed: CompletedFlight[],
  stillAirborne: number,
): SessionSummary {
  const count = (kind: SimEventRecord['event']['kind']): number =>
    records.filter((r) => r.event.kind === kind).length;

  const handoffs = completed.filter((f) => f.handedOff).length;
  const landedWithoutHandoff = completed.length - handoffs;
  const separationLosses = count('separationLoss');
  const mvaViolations = count('mvaViolation');
  const goArounds = count('goAround');

  const totalTime = completed.reduce((sum, flight) => sum + flight.timeInSector, 0);

  return {
    score:
      handoffs * SCORE_HANDOFF +
      separationLosses * SCORE_SEPARATION_LOSS +
      mvaViolations * SCORE_MVA_VIOLATION +
      goArounds * SCORE_GO_AROUND,
    handoffs,
    landedWithoutHandoff,
    separationLosses,
    mvaViolations,
    goArounds,
    averageTimeInSector: completed.length > 0 ? totalTime / completed.length : null,
    stillAirborne,
  };
}

/** The events worth listing in the debriefing, in the order they happened. */
export function notableEvents(records: SimEventRecord[]): SimEventRecord[] {
  return records.filter(
    (r) =>
      r.event.kind === 'separationLoss' ||
      r.event.kind === 'mvaViolation' ||
      r.event.kind === 'goAround' ||
      r.event.kind === 'handoffComplete',
  );
}
