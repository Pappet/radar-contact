import { describe, expect, it } from 'vitest';
import {
  atcTransmission,
  formatAltitude,
  formatHeading,
  initialCall,
  pilotReadback,
  pilotSayAgain,
  pilotUnable,
  radarContact,
} from '../src/phraseology';

const ctx = { callsign: 'SWR34K', altitude: 8000, ias: 250 };

describe('numbers (SPEC §10)', () => {
  it('speaks headings with three digits', () => {
    expect(formatHeading(90)).toBe('090');
    expect(formatHeading(270)).toBe('270');
    expect(formatHeading(5)).toBe('005');
    expect(formatHeading(0)).toBe('360');
    expect(formatHeading(360)).toBe('360');
  });

  it('switches to flight levels at 10 000 ft', () => {
    expect(formatAltitude(4000)).toBe('4000 feet');
    expect(formatAltitude(9000)).toBe('9000 feet');
    expect(formatAltitude(10000)).toBe('flight level 100');
    expect(formatAltitude(11000)).toBe('flight level 110');
  });
});

describe('ATC transmissions', () => {
  it('names the turn direction, or uses "fly heading" on auto', () => {
    expect(atcTransmission([{ kind: 'heading', deg: 270, turn: 'L' }], ctx)).toBe(
      'SWR34K, turn left heading 270',
    );
    expect(atcTransmission([{ kind: 'heading', deg: 90, turn: 'R' }], ctx)).toBe(
      'SWR34K, turn right heading 090',
    );
    expect(atcTransmission([{ kind: 'heading', deg: 270, turn: 'auto' }], ctx)).toBe(
      'SWR34K, fly heading 270',
    );
  });

  it('picks descend, climb or maintain from the current altitude', () => {
    expect(atcTransmission([{ kind: 'altitude', ft: 5000 }], ctx)).toBe(
      'SWR34K, descend and maintain 5000 feet',
    );
    expect(atcTransmission([{ kind: 'altitude', ft: 12000 }], ctx)).toBe(
      'SWR34K, climb and maintain flight level 120',
    );
    expect(atcTransmission([{ kind: 'altitude', ft: 8000 }], ctx)).toBe('SWR34K, maintain 8000 feet');
  });

  it('picks reduce or increase from the current speed', () => {
    expect(atcTransmission([{ kind: 'speed', kt: 180 }], ctx)).toBe('SWR34K, reduce speed 180 knots');
    expect(atcTransmission([{ kind: 'speed', kt: 280 }], ctx)).toBe(
      'SWR34K, increase speed 280 knots',
    );
    expect(atcTransmission([{ kind: 'speed', kt: 'normal' }], ctx)).toBe(
      'SWR34K, resume normal speed',
    );
  });

  it('strings several clearances together with commas', () => {
    expect(
      atcTransmission(
        [
          { kind: 'heading', deg: 270, turn: 'L' },
          { kind: 'altitude', ft: 5000 },
        ],
        ctx,
      ),
    ).toBe('SWR34K, turn left heading 270, descend and maintain 5000 feet');
  });
});

describe('readbacks', () => {
  it('mirrors the elements and ends with the callsign', () => {
    expect(pilotReadback([{ kind: 'heading', deg: 270, turn: 'L' }], ctx)).toBe(
      'left heading 270, SWR34K',
    );
    expect(pilotReadback([{ kind: 'heading', deg: 270, turn: 'auto' }], ctx)).toBe(
      'heading 270, SWR34K',
    );
    expect(pilotReadback([{ kind: 'altitude', ft: 5000 }], ctx)).toBe('descend 5000 feet, SWR34K');
    expect(pilotReadback([{ kind: 'speed', kt: 180 }], ctx)).toBe('speed 180 knots, SWR34K');
    expect(
      pilotReadback(
        [
          { kind: 'heading', deg: 270, turn: 'L' },
          { kind: 'altitude', ft: 5000 },
        ],
        ctx,
      ),
    ).toBe('left heading 270, descend 5000 feet, SWR34K');
  });
});

describe('fixed phrases', () => {
  it('checks in on the STAR and gets radar contact', () => {
    expect(
      initialCall({ callsign: 'SWR34K', star: 'AMIKI 1A', altitude: 9000, targetAltitude: 8000 }),
    ).toBe('Approach, SWR34K, AMIKI 1A arrival, descending 8000 feet');
    expect(
      initialCall({ callsign: 'SWR34K', star: 'AMIKI 1A', altitude: 8000, targetAltitude: 8000 }),
    ).toBe('Approach, SWR34K, AMIKI 1A arrival, level 8000 feet');
    expect(radarContact('SWR34K')).toBe('SWR34K, radar contact');
  });

  it('refuses and asks again in the SPEC wording', () => {
    expect(pilotUnable('speed restriction', 'SWR34K')).toBe('unable, speed restriction, SWR34K');
    expect(pilotSayAgain('SWR34K')).toBe('say again, SWR34K');
  });
});
