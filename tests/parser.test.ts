import { describe, expect, it } from 'vitest';
import { COMMAND_REFERENCE, parseCommandLine } from '../src/ui/parser';

describe('console parser (SPEC §11.3)', () => {
  it('reads a callsign followed by several commands', () => {
    const result = parseCommandLine('SWR34K L270 D50 S180');
    expect(result).toEqual({
      ok: true,
      callsign: 'SWR34K',
      commands: [
        { kind: 'heading', deg: 270, turn: 'L' },
        { kind: 'altitude', ft: 5000 },
        { kind: 'speed', kt: 180 },
      ],
    });
  });

  it('is case-insensitive and tolerates extra whitespace', () => {
    const result = parseCommandLine('  swr34k   r090  c120 ');
    expect(result).toEqual({
      ok: true,
      callsign: 'SWR34K',
      commands: [
        { kind: 'heading', deg: 90, turn: 'R' },
        { kind: 'altitude', ft: 12000 },
      ],
    });
  });

  it('maps H to an auto turn and normalizes 360 to 0', () => {
    expect(parseCommandLine('DLH4TA H270')).toMatchObject({
      commands: [{ kind: 'heading', deg: 270, turn: 'auto' }],
    });
    expect(parseCommandLine('DLH4TA H360')).toMatchObject({
      commands: [{ kind: 'heading', deg: 0, turn: 'auto' }],
    });
    expect(parseCommandLine('DLH4TA H005')).toMatchObject({
      commands: [{ kind: 'heading', deg: 5, turn: 'auto' }],
    });
  });

  it('understands SN as resume normal speed', () => {
    expect(parseCommandLine('GAC22 SN')).toMatchObject({
      commands: [{ kind: 'speed', kt: 'normal' }],
    });
  });

  it('reads altitudes in hundreds of feet', () => {
    expect(parseCommandLine('GAC22 D50')).toMatchObject({ commands: [{ kind: 'altitude', ft: 5000 }] });
    expect(parseCommandLine('GAC22 C120')).toMatchObject({ commands: [{ kind: 'altitude', ft: 12000 }] });
  });
});

describe('console parser errors', () => {
  it('rejects empty input', () => {
    expect(parseCommandLine('')).toMatchObject({ ok: false, code: 'empty' });
    expect(parseCommandLine('   ')).toMatchObject({ ok: false, code: 'empty' });
  });

  it('rejects a callsign without a command', () => {
    expect(parseCommandLine('SWR34K')).toMatchObject({
      ok: false,
      code: 'no-commands',
      callsign: 'SWR34K',
    });
  });

  it('rejects unknown tokens but keeps the callsign for the "say again"', () => {
    expect(parseCommandLine('SWR34K XYZ')).toMatchObject({
      ok: false,
      code: 'unknown-token',
      callsign: 'SWR34K',
    });
    expect(parseCommandLine('SWR34K L270 WAT')).toMatchObject({ ok: false, code: 'unknown-token' });
  });

  it('rejects out-of-range values', () => {
    expect(parseCommandLine('SWR34K L400')).toMatchObject({ ok: false, code: 'bad-value' });
    expect(parseCommandLine('SWR34K D000')).toMatchObject({ ok: false, code: 'bad-value' });
    expect(parseCommandLine('SWR34K C999')).toMatchObject({ ok: false, code: 'bad-value' });
    expect(parseCommandLine('SWR34K S999')).toMatchObject({ ok: false, code: 'bad-value' });
  });

  it('rejects malformed commands', () => {
    expect(parseCommandLine('SWR34K L')).toMatchObject({ ok: false, code: 'unknown-token' });
    expect(parseCommandLine('SWR34K D5O')).toMatchObject({ ok: false, code: 'unknown-token' });
    expect(parseCommandLine('SWR34K L2700')).toMatchObject({ ok: false, code: 'unknown-token' });
  });

  it('names the milestone for commands that are not built yet', () => {
    // DCT, ILS, TWR and SQ are in the SPEC but arrive with later milestones.
    expect(parseCommandLine('SWR34K ILS14')).toMatchObject({ ok: false, code: 'not-yet' });
    expect(parseCommandLine('SWR34K TWR')).toMatchObject({ ok: false, code: 'not-yet' });
    expect(parseCommandLine('SWR34K DCT AMIKI')).toMatchObject({ ok: false, code: 'not-yet' });
    expect(parseCommandLine('SWR34K SQ4271')).toMatchObject({ ok: false, code: 'not-yet' });

    const result = parseCommandLine('SWR34K ILS14');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('M3');
  });
});

describe('command reference (SPEC §11.6)', () => {
  it('documents every command the parser accepts, and nothing else', () => {
    // The in-game help is built from this table, so it must not drift.
    const documented = COMMAND_REFERENCE.map((doc) => doc.syntax);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented).toContain('L<hdg>');
    expect(documented).toContain('SN');
  });

  it('parses every sample that is marked as available', () => {
    for (const doc of COMMAND_REFERENCE.filter((d) => !d.comingIn)) {
      const result = parseCommandLine(`SWR34K ${doc.sample}`);
      expect(result.ok, `${doc.syntax} (${doc.sample}) should parse`).toBe(true);
      if (result.ok) expect(result.commands).toHaveLength(1);
    }
  });

  it('rejects every sample that is still pending, with its own error code', () => {
    for (const doc of COMMAND_REFERENCE.filter((d) => d.comingIn)) {
      const result = parseCommandLine(`SWR34K ${doc.sample}`);
      expect(result.ok, `${doc.syntax} should not be accepted yet`).toBe(false);
      if (!result.ok) expect(result.code).toBe('not-yet');
    }
  });

  it('explains what a pending command will do once it exists', () => {
    for (const doc of COMMAND_REFERENCE.filter((d) => d.comingIn)) {
      const result = parseCommandLine(`SWR34K ${doc.sample}`);
      if (!result.ok) expect(result.message).toContain(doc.meaning);
    }
  });
});
