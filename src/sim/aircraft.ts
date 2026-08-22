/**
 * Aircraft type profiles (data, SPEC §13.1) and the per-aircraft state (SPEC §4).
 */

import typesJson from '../data/aircraft.json';
import { NORMAL_SPEED_HIGH_KT, SPEED_RESTRICTION_ALT_FT, SPEED_RESTRICTION_IAS_KT } from './constants';
import type { Command } from './commands';
import type { Vec2 } from './geo';
import type { Phase } from './phases';

export type WakeCategory = 'L' | 'M' | 'H';

export interface AircraftTypeProfile {
  wake: WakeCategory;
  /** ft/min */
  climbRate: number;
  /** ft/min */
  descentRate: number;
  /** kt IAS */
  vMin: number;
  /** kt IAS, final approach speed */
  vApp: number;
  /** kt IAS */
  vMax: number;
}

export const AIRCRAFT_TYPES = typesJson as Record<string, AircraftTypeProfile>;

export function aircraftProfile(type: string): AircraftTypeProfile {
  const profile = AIRCRAFT_TYPES[type];
  if (!profile) throw new Error(`Unknown aircraft type: ${type}`);
  return profile;
}

/** One entry of the pilot's work queue: commands that become targets at executeAt. */
export interface PilotQueueEntry {
  cmds: Command[];
  /** Sim time (s) at which the readback is spoken and the targets are set. */
  executeAt: number;
}

export interface AircraftTargets {
  heading?: { deg: number; turn: 'L' | 'R' | 'auto' };
  /** ft */
  altitude: number;
  /** kt IAS */
  speed: number;
  /** Name of a fix the aircraft steers towards continuously. */
  directTo?: string;
}

export interface AircraftState {
  id: string;
  callsign: string;
  /** Key into aircraft.json */
  type: string;
  /** NM on the sector grid */
  pos: Vec2;
  /** ft */
  altitude: number;
  /** ° true */
  heading: number;
  /** ° true, heading corrected for wind */
  track: number;
  ias: number;
  tas: number;
  gs: number;
  /** ft/min */
  vs: number;
  target: AircraftTargets;
  phase: Phase;
  wake: WakeCategory;
  squawk: string;
  onFrequency: boolean;
  clearedIls?: string;
  pilot: { queue: PilotQueueEntry[]; hearbackTaken?: Command[] };
  /** Sim time (s) of the spawn */
  spawnedAt: number;
  /** Data block offset from the blip, in screen px (SPEC §9, draggable) */
  labelOffset: Vec2;
  /** Last snapshot positions, oldest first (SPEC §3) */
  trail: Vec2[];
  /** Fixes still to be flown on the STAR, in order (SPEC §7) */
  route: string[];
  /** STAR the aircraft arrived on, used for the initial call (SPEC §10) */
  star?: string;
}

/**
 * Speed the pilot resumes on "resume normal speed".
 * Below FL100 the 250 kt restriction applies, above it we cap at a typical
 * arrival cruise speed rather than the type's structural maximum.
 */
export function normalSpeed(profile: AircraftTypeProfile, altitudeFt: number): number {
  const ceiling =
    altitudeFt < SPEED_RESTRICTION_ALT_FT ? SPEED_RESTRICTION_IAS_KT : NORMAL_SPEED_HIGH_KT;
  return Math.max(profile.vMin, Math.min(profile.vMax, ceiling));
}
