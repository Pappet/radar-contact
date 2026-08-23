import { describe, expect, it } from 'vitest';
import { notableEvents, summarize } from '../src/score';
import type { SimEvent, SimEventRecord } from '../src/sim/events';
import type { CompletedFlight } from '../src/sim/state';

const at = (time: number, event: SimEvent): SimEventRecord => ({ at: time, event });

const flight = (
  callsign: string,
  handedOff: boolean,
  timeInSector: number,
): CompletedFlight => ({ callsign, handedOff, at: timeInSector, timeInSector });

describe('score (SPEC §11.5)', () => {
  it('is zero for an empty session', () => {
    expect(summarize([], [], 0)).toMatchObject({
      score: 0,
      handoffs: 0,
      averageTimeInSector: null,
      stillAirborne: 0,
    });
  });

  it('pays 100 per clean handoff and nothing for a landing without one', () => {
    const summary = summarize(
      [at(100, { kind: 'handoffComplete', callsign: 'AAA111' })],
      [flight('AAA111', true, 600), flight('BBB222', false, 800)],
      0,
    );
    expect(summary.score).toBe(100);
    expect(summary.handoffs).toBe(1);
    expect(summary.landedWithoutHandoff).toBe(1);
  });

  it('charges for separation, MVA and go-arounds', () => {
    const summary = summarize(
      [
        at(10, { kind: 'separationLoss', a: 'AAA111', b: 'BBB222' }),
        at(20, { kind: 'mvaViolation', callsign: 'CCC333' }),
        at(30, { kind: 'goAround', callsign: 'DDD444', reason: 'tooHigh' }),
        at(40, { kind: 'goAround', callsign: 'EEE555', reason: 'spacing' }),
      ],
      [],
      0,
    );
    expect(summary.separationLosses).toBe(1);
    expect(summary.mvaViolations).toBe(1);
    expect(summary.goArounds).toBe(2);
    // −1000 − 300 − 2 × 200
    expect(summary.score).toBe(-1700);
  });

  it('counts every go-around the same in v1', () => {
    const spacing = summarize([at(1, { kind: 'goAround', callsign: 'A', reason: 'spacing' })], [], 0);
    const tooHigh = summarize([at(1, { kind: 'goAround', callsign: 'A', reason: 'tooHigh' })], [], 0);
    expect(spacing.score).toBe(tooHigh.score);
  });

  it('averages the time in sector over completed flights only', () => {
    const summary = summarize([], [flight('A', true, 600), flight('B', true, 900)], 3);
    expect(summary.averageTimeInSector).toBe(750);
    expect(summary.stillAirborne).toBe(3);
  });

  it('adds the good and the bad together', () => {
    const summary = summarize(
      [
        at(10, { kind: 'handoffComplete', callsign: 'AAA111' }),
        at(20, { kind: 'handoffComplete', callsign: 'BBB222' }),
        at(30, { kind: 'separationLoss', a: 'AAA111', b: 'BBB222' }),
      ],
      [flight('AAA111', true, 500), flight('BBB222', true, 700)],
      1,
    );
    // 2 × 100 − 1000
    expect(summary.score).toBe(-800);
  });
});

describe('debriefing event list (SPEC §11.5)', () => {
  it('keeps what the controller should see, in order', () => {
    const records = [
      at(5, { kind: 'spawned', callsign: 'AAA111', star: 'AMIKI 1A' }),
      at(6, { kind: 'transmission', from: 'atc', callsign: 'AAA111', text: 'radar contact' }),
      at(10, { kind: 'stca', pairs: [['AAA111', 'BBB222']] }),
      at(20, { kind: 'separationLoss', a: 'AAA111', b: 'BBB222' }),
      at(30, { kind: 'handoffComplete', callsign: 'AAA111' }),
    ];

    const notable = notableEvents(records);
    expect(notable.map((r) => r.at)).toEqual([20, 30]);
  });
});
