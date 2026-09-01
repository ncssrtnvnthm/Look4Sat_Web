// ── Doppler frequency math (mirrors OrbitalPos.getDownlinkFreq/getUplinkFreq) ──

export const SPEED_OF_LIGHT = 299_792_458; // m/s

/**
 * Doppler-shifted frequency in Hz for a given range rate (km/s).
 * - Downlink: satellite moving away (positive range rate) lowers the received
 *   frequency → shift with minus.
 * - Uplink: you must transmit higher to hit a receding satellite → shift with plus.
 */
export function dopplerShiftFreq(baseHz: number, rangeRateKmS: number, uplink: boolean): number {
  if (!Number.isFinite(baseHz) || !Number.isFinite(rangeRateKmS)) return baseHz;
  const v = rangeRateKmS * 1000; // km/s → m/s
  return (baseHz * (SPEED_OF_LIGHT + (uplink ? v : -v))) / SPEED_OF_LIGHT;
}
