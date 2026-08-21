/**
 * All radio phraseology (SPEC §10). No other module may build radio text.
 *
 * Numbers: headings are three digits, altitudes below 10 000 ft are spoken in
 * feet, from 10 000 ft upwards as a flight level.
 */

import type { Command } from './sim/commands';

export interface RadioContext {
  callsign: string;
  /** Current altitude in ft — decides "descend" vs "climb" vs "maintain". */
  altitude: number;
  /** Current IAS in kt — decides "reduce" vs "increase". */
  ias: number;
  /** Tower frequency for the handoff, e.g. "118.1". */
  towerFreq?: string;
}

export function formatHeading(deg: number): string {
  const normalized = ((Math.round(deg) % 360) + 360) % 360;
  const spoken = normalized === 0 ? 360 : normalized;
  return String(spoken).padStart(3, '0');
}

export function formatAltitude(ft: number): string {
  const rounded = Math.round(ft);
  if (rounded >= 10000) return `flight level ${Math.round(rounded / 100)}`;
  return `${rounded} feet`;
}

/** "118.1" → "118 decimal 1" */
export function formatFrequency(freq: string): string {
  return freq.replace('.', ' decimal ');
}

function verticalVerb(targetFt: number, currentFt: number): 'descend' | 'climb' | 'maintain' {
  if (targetFt < currentFt) return 'descend';
  if (targetFt > currentFt) return 'climb';
  return 'maintain';
}

function atcElement(cmd: Command, ctx: RadioContext): string {
  switch (cmd.kind) {
    case 'heading':
      return cmd.turn === 'auto'
        ? `fly heading ${formatHeading(cmd.deg)}`
        : `turn ${cmd.turn === 'L' ? 'left' : 'right'} heading ${formatHeading(cmd.deg)}`;
    case 'altitude': {
      const verb = verticalVerb(cmd.ft, ctx.altitude);
      const tail = formatAltitude(cmd.ft);
      return verb === 'maintain' ? `maintain ${tail}` : `${verb} and maintain ${tail}`;
    }
    case 'speed':
      if (cmd.kt === 'normal') return 'resume normal speed';
      return `${cmd.kt < ctx.ias ? 'reduce' : 'increase'} speed ${cmd.kt} knots`;
    case 'direct':
      return `proceed direct ${cmd.fix}`;
    case 'ils':
      return `cleared ILS approach runway ${cmd.runway}`;
    case 'hold':
      return `hold at ${cmd.fix} as published`;
    case 'handoff':
      return `contact tower ${formatFrequency(ctx.towerFreq ?? '118.1')}`;
    case 'squawk':
      return `squawk ${cmd.code}`;
  }
}

function readbackElement(cmd: Command, ctx: RadioContext): string {
  switch (cmd.kind) {
    case 'heading':
      return cmd.turn === 'auto'
        ? `heading ${formatHeading(cmd.deg)}`
        : `${cmd.turn === 'L' ? 'left' : 'right'} heading ${formatHeading(cmd.deg)}`;
    case 'altitude':
      return `${verticalVerb(cmd.ft, ctx.altitude)} ${formatAltitude(cmd.ft)}`;
    case 'speed':
      return cmd.kt === 'normal' ? 'normal speed' : `speed ${cmd.kt} knots`;
    case 'direct':
      return `direct ${cmd.fix}`;
    case 'ils':
      return `cleared ILS ${cmd.runway}`;
    case 'hold':
      return `hold at ${cmd.fix}`;
    case 'handoff':
      return `tower ${formatFrequency(ctx.towerFreq ?? '118.1')}`;
    case 'squawk':
      return `squawk ${cmd.code}`;
  }
}

/** "SWR34K, turn left heading 270, descend and maintain 5000 feet" */
export function atcTransmission(cmds: Command[], ctx: RadioContext): string {
  return `${ctx.callsign}, ${cmds.map((c) => atcElement(c, ctx)).join(', ')}`;
}

/** "left heading 270, descend 5000 feet, SWR34K" */
export function pilotReadback(cmds: Command[], ctx: RadioContext): string {
  const elements = cmds.map((c) => readbackElement(c, ctx));
  const tail = cmds.length === 1 && cmds[0]?.kind === 'handoff' ? `${ctx.callsign}, good day` : ctx.callsign;
  return `${elements.join(', ')}, ${tail}`;
}

/** "unable, speed restriction, SWR34K" */
export function pilotUnable(reason: string, callsign: string): string {
  return `unable, ${reason}, ${callsign}`;
}

export function pilotSayAgain(callsign: string): string {
  return `say again, ${callsign}`;
}

/** "Approach, SWR34K, AMIKI 1A arrival, descending 9000 feet" */
export function initialCall(params: {
  callsign: string;
  star?: string;
  altitude: number;
  targetAltitude: number;
}): string {
  const arrival = params.star ? `${params.star} arrival` : 'inbound';
  const vertical =
    params.targetAltitude < params.altitude
      ? `descending ${formatAltitude(params.targetAltitude)}`
      : `level ${formatAltitude(params.altitude)}`;
  return `Approach, ${params.callsign}, ${arrival}, ${vertical}`;
}

/** "SWR34K, radar contact" */
export function radarContact(callsign: string): string {
  return `${callsign}, radar contact`;
}
