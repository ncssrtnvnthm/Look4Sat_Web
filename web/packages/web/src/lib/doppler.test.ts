import { describe, it, expect } from 'vitest';
import { dopplerShiftFreq, SPEED_OF_LIGHT } from './doppler';

describe('dopplerShiftFreq', () => {
  it('receding satellite lowers the downlink frequency', () => {
    // ISS-like: 435 MHz downlink, 7 km/s approach rate
    const shifted = dopplerShiftFreq(435_000_000, 7, false);
    const expected = 435_000_000 * (SPEED_OF_LIGHT - 7000) / SPEED_OF_LIGHT;
    expect(shifted).toBeCloseTo(expected, 6);
    expect(shifted).toBeLessThan(435_000_000);
  });

  it('receding satellite raises the required uplink frequency', () => {
    const shifted = dopplerShiftFreq(145_000_000, 7, true);
    expect(shifted).toBeGreaterThan(145_000_000);
  });

  it('approaching satellite (negative range rate) raises downlink / lowers uplink', () => {
    expect(dopplerShiftFreq(435_000_000, -7, false)).toBeGreaterThan(435_000_000);
    expect(dopplerShiftFreq(145_000_000, -7, true)).toBeLessThan(145_000_000);
  });

  it('zero range rate leaves the frequency unchanged', () => {
    expect(dopplerShiftFreq(435_000_000, 0, false)).toBe(435_000_000);
  });

  it('handles non-finite inputs defensively', () => {
    expect(dopplerShiftFreq(Number.NaN, 7, false)).toBe(Number.NaN);
    expect(dopplerShiftFreq(435_000_000, Number.NaN, false)).toBe(435_000_000);
  });
});
