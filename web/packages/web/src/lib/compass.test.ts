import { describe, it, expect } from 'vitest';
import { quaternionToHeading, computeMagDeclination, deviceHeading } from './compass';

describe('quaternionToHeading', () => {
  it('identity quaternion points north (0°)', () => {
    expect(quaternionToHeading(0, 0, 0, 1)).toBeCloseTo(0, 5);
  });

  it('a 90° yaw produces the compass-convention heading', () => {
    // q = (0, 0, sin(45°), cos(45°)) is a 90° rotation about Z
    const s = Math.SQRT1_2;
    expect(quaternionToHeading(0, 0, s, s)).toBeCloseTo(270, 5);
  });

  it('always returns a value in [0, 360)', () => {
    for (let i = 0; i < 360; i += 15) {
      const rad = (i * Math.PI) / 360; // half-angles
      const h = quaternionToHeading(0, 0, Math.sin(rad), Math.cos(rad));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('computeMagDeclination', () => {
  it('is deterministic for the same coordinates', () => {
    expect(computeMagDeclination(51.5, 0)).toBe(computeMagDeclination(51.5, 0));
  });

  it('returns a sane declination near Greenwich (truncated WMM2020, ±15°)', () => {
    const d = computeMagDeclination(51.5, 0);
    expect(d).toBeGreaterThan(-15);
    expect(d).toBeLessThan(15);
  });

  it('handles the equator', () => {
    const d = computeMagDeclination(0, 0);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe('deviceHeading', () => {
  it('iOS webkitCompassHeading is magnetic — adds declination for true north', () => {
    const res = deviceHeading(90, null, undefined, 2.5, false);
    expect(res.heading).toBeCloseTo(92.5, 9);
  });

  it('absolute alpha is already true-north — used as-is', () => {
    const res = deviceHeading(null, 90, true, 2.5, false);
    expect(res.heading).toBeCloseTo(90, 9);
    expect(res.sawAbsolute).toBe(true);
  });

  it('relative alpha is a fallback, ignored once an absolute reading was seen', () => {
    const first = deviceHeading(null, 90, true, 0, false);
    const second = deviceHeading(null, 45, false, 0, first.sawAbsolute);
    expect(second.heading).toBeNull();
  });

  it('relative alpha tracked only until absolute arrives', () => {
    const res = deviceHeading(null, 45, false, 0, false);
    expect(res.heading).toBeCloseTo(45, 9);
    expect(res.sawAbsolute).toBe(false);
  });

  it('normalizes to [0, 360)', () => {
    expect(deviceHeading(359, null, undefined, 2, false).heading).toBeCloseTo(1, 9);
  });

  it('ignores events with no heading data', () => {
    expect(deviceHeading(null, null, undefined, 0, false).heading).toBeNull();
  });
});
