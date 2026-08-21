import { describe, expect, it } from 'vitest';
import { parseCommandLine } from '../src/ui/parser';

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

  it('does not accept commands that belong to later milestones yet', () => {
    // DCT, ILS, TWR and SQ arrive with M2–M4 (SPEC §14).
    expect(parseCommandLine('SWR34K ILS14')).toMatchObject({ ok: false, code: 'unknown-token' });
    expect(parseCommandLine('SWR34K TWR')).toMatchObject({ ok: false, code: 'unknown-token' });
  });
});
