import { describe, expect, it } from 'vitest';
import { aircraftProfile } from '../src/sim/aircraft';
import { angleDiff } from '../src/sim/geo';
import {
  CALM,
  groundVector,
  headingForTrack,
  iasToTas,
  integratePosition,
  stepAltitude,
  stepHeading,
  stepIas,
  turnRateDegPerS,
  windAt,
  type WindProfile,
} from '../src/sim/physics';

const A320 = aircraftProfile('A320');

describe('turn rate (SPEC §5.2)', () => {
  it('is 508 / TAS, limited to 3 °/s', () => {
    expect(turnRateDegPerS(250)).toBeCloseTo(2.032, 6);
    expect(turnRateDegPerS(508)).toBeCloseTo(1, 6);
    expect(turnRateDegPerS(150)).toBe(3);
    expect(turnRateDegPerS(0)).toBe(3);
  });
});

describe('turn geometry', () => {
  const tas = 254; // 2 °/s

  it('takes the shorter way round on auto', () => {
    expect(stepHeading(350, 10, 'auto', tas, 1)).toBeCloseTo(352, 6);
    expect(stepHeading(10, 350, 'auto', tas, 1)).toBeCloseTo(8, 6);
    expect(stepHeading(0, 179, 'auto', tas, 1)).toBeCloseTo(2, 6);
    expect(stepHeading(0, 181, 'auto', tas, 1)).toBeCloseTo(358, 6);
  });

  it('follows a forced direction even when it is the long way', () => {
    expect(stepHeading(0, 90, 'L', tas, 1)).toBeCloseTo(358, 6);
    expect(stepHeading(0, 270, 'R', tas, 1)).toBeCloseTo(2, 6);
  });

  it('never overshoots the target heading', () => {
    expect(stepHeading(89, 90, 'auto', tas, 1)).toBe(90);
    expect(stepHeading(91, 90, 'auto', tas, 1)).toBe(90);
    expect(stepHeading(90, 90, 'L', tas, 1)).toBe(90);
  });

  it('arrives exactly and then stays put', () => {
    let heading = 360 - 43;
    for (let i = 0; i < 200; i += 1) heading = stepHeading(heading, 90, 'R', tas, 1);
    expect(heading).toBe(90);
    expect(stepHeading(heading, 90, 'R', tas, 1)).toBe(90);
  });

  it('wraps through north without a detour', () => {
    let heading = 350;
    const steps: number[] = [];
    // 30° at 2 °/s needs 15 ticks.
    for (let i = 0; i < 15; i += 1) {
      heading = stepHeading(heading, 20, 'auto', tas, 1);
      steps.push(heading);
    }
    expect(steps.some((h) => h > 180 && h < 350)).toBe(false);
    expect(heading).toBe(20);
  });
});

describe('IAS → TAS (SPEC §5.5)', () => {
  it('adds 2 % per 1000 ft', () => {
    expect(iasToTas(250, 0)).toBeCloseTo(250, 9);
    expect(iasToTas(250, 10000)).toBeCloseTo(300, 9);
    expect(iasToTas(200, 5000)).toBeCloseTo(220, 9);
    expect(iasToTas(180, 2500)).toBeCloseTo(189, 9);
  });
});

describe('speed changes (SPEC §5.3)', () => {
  it('changes 1 kt/s in level flight', () => {
    expect(stepIas(250, 220, false, 1)).toBe(249);
    expect(stepIas(220, 250, false, 1)).toBe(221);
  });

  it('only manages 0.5 kt/s while slowing down in a descent', () => {
    expect(stepIas(250, 220, true, 1)).toBe(249.5);
    expect(stepIas(220, 250, true, 1)).toBe(221);
  });

  it('does not overshoot the target speed', () => {
    expect(stepIas(220.4, 220, false, 1)).toBe(220);
    expect(stepIas(220, 220, false, 1)).toBe(220);
  });
});

describe('vertical (SPEC §5.4)', () => {
  it('descends at the type rate', () => {
    const step = stepAltitude(8000, 5000, A320, false, 1);
    expect(step.altitude).toBeCloseTo(8000 - 1800 / 60, 9);
    expect(step.vs).toBeCloseTo(-1800, 9);
  });

  it('loses 40 % of the descent rate while decelerating', () => {
    const step = stepAltitude(8000, 5000, A320, true, 1);
    expect(step.vs).toBeCloseTo(-1080, 9);
  });

  it('climbs at the climb rate and ignores the deceleration factor', () => {
    const step = stepAltitude(5000, 8000, A320, true, 1);
    expect(step.vs).toBeCloseTo(2200, 9);
  });

  it('levels off exactly on the target', () => {
    const step = stepAltitude(5010, 5000, A320, false, 1);
    expect(step.altitude).toBe(5000);
    expect(step.vs).toBeCloseTo(-600, 9);
    expect(stepAltitude(5000, 5000, A320, false, 1)).toEqual({ altitude: 5000, vs: 0 });
  });
});

describe('wind (SPEC §5.5)', () => {
  const profile: WindProfile = {
    surface: { dir: 140, kt: 8 },
    fl100: { dir: 210, kt: 35 },
  };

  it('interpolates linearly up to FL100 and stays constant above', () => {
    expect(windAt(profile, 0)).toEqual({ dir: 140, kt: 8 });
    expect(windAt(profile, 5000).dir).toBeCloseTo(175, 9);
    expect(windAt(profile, 5000).kt).toBeCloseTo(21.5, 9);
    expect(windAt(profile, 10000).dir).toBeCloseTo(210, 9);
    expect(windAt(profile, 30000).kt).toBeCloseTo(35, 9);
  });

  it('leaves track and ground speed alone when calm', () => {
    const ground = groundVector(137, 260, windAt(CALM, 8000));
    expect(ground.track).toBeCloseTo(137, 9);
    expect(ground.gs).toBeCloseTo(260, 9);
  });

  it('adds a headwind to the track and subtracts it from the ground speed', () => {
    const ground = groundVector(90, 200, { dir: 90, kt: 40 });
    expect(ground.gs).toBeCloseTo(160, 9);
    expect(ground.track).toBeCloseTo(90, 9);
  });

  it('drifts the track with a crosswind', () => {
    const ground = groundVector(360, 200, { dir: 270, kt: 20 });
    expect(ground.track).toBeGreaterThan(0);
    expect(ground.track).toBeCloseTo(5.71, 2);
  });
});

describe('crabbing into the wind (SPEC §7)', () => {
  it('flies the heading that makes the track come out right', () => {
    const wind = { dir: 90, kt: 30 }; // from the east
    const heading = headingForTrack(360, 200, wind);
    // The wind pushes west, so the aircraft has to point east of north.
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(20);

    // Flying that heading really does produce the wanted track. Compared
    // through angleDiff, because north comes out as either 0 or 360.
    const ground = groundVector(heading, 200, wind);
    expect(Math.abs(angleDiff(360, ground.track))).toBeLessThan(1e-6);
  });

  it('needs no correction in calm air', () => {
    expect(headingForTrack(137, 220, { dir: 0, kt: 0 })).toBeCloseTo(137, 9);
  });

  it('needs no correction for a pure headwind or tailwind', () => {
    expect(headingForTrack(137, 220, { dir: 137, kt: 40 })).toBeCloseTo(137, 6);
    expect(headingForTrack(137, 220, { dir: 317, kt: 40 })).toBeCloseTo(137, 6);
  });

  it('crabs into the wind from either side', () => {
    const fromLeft = headingForTrack(137, 220, { dir: 47, kt: 30 });
    const fromRight = headingForTrack(137, 220, { dir: 227, kt: 30 });
    expect(angleDiff(137, fromLeft)).toBeLessThan(0);
    expect(angleDiff(137, fromRight)).toBeGreaterThan(0);
    expect(Math.abs(angleDiff(137, fromLeft))).toBeCloseTo(Math.abs(angleDiff(137, fromRight)), 6);
  });

  it('holds the approach course exactly with the sector wind', () => {
    const wind = { dir: 210, kt: 35 };
    const heading = headingForTrack(137, 260, wind);
    const ground = groundVector(heading, 260, wind);
    expect(ground.track).toBeCloseTo(137, 6);
    // The crab is real, not a rounding artefact.
    expect(Math.abs(angleDiff(137, heading))).toBeGreaterThan(3);
  });
});

describe('position integration (SPEC §5.6)', () => {
  it('moves ground speed nautical miles per hour', () => {
    const after = integratePosition({ x: 0, y: 0 }, 90, 360, 60);
    expect(after.x).toBeCloseTo(6, 9);
    expect(after.y).toBeCloseTo(0, 9);
  });
});
