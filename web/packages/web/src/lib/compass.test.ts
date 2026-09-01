import { describe, it, expect } from 'vitest';
import { quaternionToHeading, computeMagDeclination } from './compass';

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
