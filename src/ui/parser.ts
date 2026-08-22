/**
 * Console grammar (SPEC §11.3): `CALLSIGN CMD [CMD ...]`, case-insensitive.
 * Pure text → Command[]; the console widget only handles the DOM around it.
 *
 * M1 covers L/R/H, D/C, S/SN. DCT, ILS, TWR and SQ arrive with M2–M4 and are
 * rejected until then.
 */

import type { Command, TurnDirection } from '../sim/commands';

export type ParseErrorCode = 'empty' | 'no-commands' | 'unknown-token' | 'bad-value';

export type ParseResult =
  | { ok: true; callsign: string; commands: Command[] }
  | { ok: false; code: ParseErrorCode; message: string; callsign?: string };

const HEADING = /^([LRH])(\d{1,3})$/;
const ALTITUDE = /^([DC])(\d{1,3})$/;
const SPEED = /^S(\d{2,3})$/;

/** Hundreds of feet, as flown in the console: D50 → 5000 ft. */
const MIN_ALTITUDE_HUNDREDS = 1;
const MAX_ALTITUDE_HUNDREDS = 600;
const MIN_SPEED_KT = 40;
const MAX_SPEED_KT = 500;

function turnOf(letter: string): TurnDirection {
  if (letter === 'L') return 'L';
  if (letter === 'R') return 'R';
  return 'auto';
}

function parseToken(token: string): Command | { error: ParseResult } {
  if (token === 'SN') return { kind: 'speed', kt: 'normal' };

  const heading = HEADING.exec(token);
  if (heading) {
    const deg = Number(heading[2]);
    if (deg > 360) {
      return { error: { ok: false, code: 'bad-value', message: `Heading out of range: ${token}` } };
    }
    return { kind: 'heading', deg: deg % 360, turn: turnOf(heading[1] ?? 'H') };
  }

  const altitude = ALTITUDE.exec(token);
  if (altitude) {
    const hundreds = Number(altitude[2]);
    if (hundreds < MIN_ALTITUDE_HUNDREDS || hundreds > MAX_ALTITUDE_HUNDREDS) {
      return { error: { ok: false, code: 'bad-value', message: `Altitude out of range: ${token}` } };
    }
    return { kind: 'altitude', ft: hundreds * 100 };
  }

  const speed = SPEED.exec(token);
  if (speed) {
    const kt = Number(speed[1]);
    if (kt < MIN_SPEED_KT || kt > MAX_SPEED_KT) {
      return { error: { ok: false, code: 'bad-value', message: `Speed out of range: ${token}` } };
    }
    return { kind: 'speed', kt };
  }

  return { error: { ok: false, code: 'unknown-token', message: `Unknown command: ${token}` } };
}

export function parseCommandLine(input: string): ParseResult {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, code: 'empty', message: 'Nothing entered' };

  const callsign = tokens[0] as string;
  const rest = tokens.slice(1);
  if (rest.length === 0) {
    return { ok: false, code: 'no-commands', message: `No command for ${callsign}`, callsign };
  }

  const commands: Command[] = [];
  for (const token of rest) {
    const parsed = parseToken(token);
    if ('error' in parsed) return { ...parsed.error, callsign };
    commands.push(parsed);
  }

  return { ok: true, callsign, commands };
}
