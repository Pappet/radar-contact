/**
 * Console grammar (SPEC §11.3): `CALLSIGN CMD [CMD ...]`, case-insensitive.
 * Pure text → Command[]; the console widget only handles the DOM around it.
 *
 * M1 covers L/R/H, D/C, S/SN. DCT, ILS, TWR and SQ arrive with M2–M4 and are
 * rejected until then.
 */

import type { Command, TurnDirection } from '../sim/commands';

export type ParseErrorCode =
  | 'empty'
  | 'no-commands'
  | 'unknown-token'
  | 'bad-value'
  /** A command the SPEC defines but the current milestone has not built yet. */
  | 'not-yet';

/**
 * The command reference, right next to the grammar that implements it, so the
 * in-game help (SPEC §11.6) cannot drift from what the parser accepts.
 * `sample` is checked against the parser by the tests.
 */
export interface CommandDoc {
  /** How it is written, e.g. "L<hdg>". */
  syntax: string;
  /** A concrete input that must behave as documented. */
  sample: string;
  meaning: string;
  /** Set when the command is not built yet; names the milestone if known. */
  comingIn?: string | undefined;
}

export const COMMAND_REFERENCE: CommandDoc[] = [
  { syntax: 'L<hdg>', sample: 'L270', meaning: 'Turn left onto heading 270' },
  { syntax: 'R<hdg>', sample: 'R090', meaning: 'Turn right onto heading 090' },
  { syntax: 'H<hdg>', sample: 'H360', meaning: 'Fly heading 360, turning the short way' },
  { syntax: 'D<alt>', sample: 'D50', meaning: 'Descend to 5000 ft — altitude in hundreds' },
  { syntax: 'C<alt>', sample: 'C120', meaning: 'Climb to 12 000 ft' },
  { syntax: 'S<kt>', sample: 'S180', meaning: 'Speed 180 kt' },
  { syntax: 'SN', sample: 'SN', meaning: 'Resume normal speed' },
  { syntax: 'ILS<rwy>', sample: 'ILS14', meaning: 'Cleared ILS approach runway 14' },
  { syntax: 'TWR', sample: 'TWR', meaning: 'Contact tower — hand the aircraft off' },
  { syntax: 'DCT <fix>', sample: 'DCT AMIKI', meaning: 'Proceed direct to a fix', comingIn: 'M4' },
  { syntax: 'SQ<code>', sample: 'SQ4271', meaning: 'Squawk 4271', comingIn: 'later' },
];

/** Commands that are written down but not built yet, matched on the token. */
const PENDING: { pattern: RegExp; doc: CommandDoc }[] = COMMAND_REFERENCE.filter(
  (doc) => doc.comingIn !== undefined,
).map((doc) => ({
  // The leading letters of the syntax identify the token.
  pattern: new RegExp(`^${(doc.syntax.match(/^[A-Z]+/) ?? [''])[0]}(\\d.*)?$`),
  doc,
}));

export type ParseResult =
  | { ok: true; callsign: string; commands: Command[] }
  | { ok: false; code: ParseErrorCode; message: string; callsign?: string };

const HEADING = /^([LRH])(\d{1,3})$/;
const ALTITUDE = /^([DC])(\d{1,3})$/;
const SPEED = /^S(\d{2,3})$/;
const ILS = /^ILS(\d{2}[LRC]?)$/;

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

  const approach = parseApproachToken(token);
  if (approach) return approach;

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

  const pending = PENDING.find((entry) => entry.pattern.test(token));
  if (pending) {
    const when = pending.doc.comingIn === 'later' ? 'is not built yet' : `arrives with ${pending.doc.comingIn}`;
    return {
      error: {
        ok: false,
        code: 'not-yet',
        message: `${pending.doc.syntax} (${pending.doc.meaning}) ${when}`,
      },
    };
  }

  return { error: { ok: false, code: 'unknown-token', message: `Unknown command: ${token}` } };
}

function parseApproachToken(token: string): Command | { error: ParseResult } | null {
  if (token === 'TWR') return { kind: 'handoff' };
  if (!token.startsWith('ILS')) return null;

  const ils = ILS.exec(token);
  if (ils) return { kind: 'ils', runway: ils[1] as string };
  return {
    error: {
      ok: false,
      code: 'bad-value',
      message: `${token}: an ILS clearance needs a runway, e.g. ILS14`,
    },
  };
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
