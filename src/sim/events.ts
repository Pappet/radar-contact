/**
 * The sim→host event queue (SPEC §3).
 * Events are the only way the simulation talks to UI and audio.
 */

export type SimEvent =
  | { kind: 'transmission'; from: 'atc' | 'pilot'; callsign: string; text: string }
  | { kind: 'separationLoss'; a: string; b: string }
  | { kind: 'stca'; pairs: [string, string][] }
  | { kind: 'goAround'; callsign: string; reason: 'notEstablished' | 'tooHigh' | 'spacing' }
  | { kind: 'handoffComplete'; callsign: string }
  | { kind: 'mvaViolation'; callsign: string }
  | { kind: 'spawned'; callsign: string; star: string };

/** An event together with the sim time it happened at (SPEC §11.2, §11.5). */
export interface SimEventRecord {
  /** Sim time in seconds. */
  at: number;
  event: SimEvent;
}

/** Anything that can take events — SimState satisfies this structurally. */
export interface EventSink {
  time: number;
  events: SimEventRecord[];
}

export function emit(sink: EventSink, event: SimEvent): void {
  sink.events.push({ at: sink.time, event });
}
