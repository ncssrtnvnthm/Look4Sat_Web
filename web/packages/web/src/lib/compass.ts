// ── Compass math helpers (pure, unit-testable) ──

/**
 * Convert a quaternion [x, y, z, w] to a compass heading in degrees
 * (0 = north, 90 = east), using the Z-X-Y device-orientation convention.
 * Yaw (psi) = atan2(2*(q0*q3 + q1*q2), 1 - 2*(q2^2 + q3^2)) with q0=w, q1=x, q2=y, q3=z.
 */
export function quaternionToHeading(x: number, y: number, z: number, w: number): number {
  const yaw = Math.atan2(
    2 * (w * z + x * y),
    1 - 2 * (y * y + z * z),
  );
  // Convert to degrees (0-360), negate to match compass convention
  let heading = (-yaw * 180) / Math.PI;
  heading = ((heading % 360) + 360) % 360;
  return heading;
}

/**
 * Magnetic declination at a location, degrees east of true north.
 * WMM2020 Gauss coefficients truncated to n=3 (no secular variation),
 * so results are approximate (±1°).
 */
export function computeMagDeclination(lat: number, lon: number): number {
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  // WMM2020 Gauss coefficients (nT), truncated to n=3
  const g10 = -29404.5, g11 = -1450.7, h11 = 4652.9;
  const g20 = -2500.0, g21 = 2982.0, h21 = -2991.0, g22 = 1676.8, h22 = -734.8;
  const g30 = 1363.9, g31 = -2381.0, h31 = -82.3, g32 = 1236.2, h32 = 241.8, g33 = 525.7, h33 = -542.9;

  const dp10 = cosPhi;
  const p11 = cosPhi, dp11 = -sinPhi;
  const dp20 = 3.0 * sinPhi * cosPhi;
  const p21 = 3.0 * sinPhi * cosPhi, dp21 = 3.0 * (cosPhi * cosPhi - sinPhi * sinPhi);
  const p22 = 3.0 * cosPhi * cosPhi, dp22 = -6.0 * sinPhi * cosPhi;
  const dp30 = (7.5 * sinPhi * sinPhi - 1.5) * cosPhi;
  const p31 = 1.5 * (5.0 * sinPhi * sinPhi - 1.0) * cosPhi;
  const dp31 = 1.5 * ((10.0 * sinPhi * cosPhi * cosPhi) - (5.0 * sinPhi * sinPhi - 1.0) * sinPhi);
  const p32 = 15.0 * sinPhi * cosPhi * cosPhi, dp32 = 15.0 * (cosPhi * cosPhi * cosPhi - 2.0 * sinPhi * sinPhi * cosPhi);
  const p33 = 15.0 * cosPhi * cosPhi * cosPhi, dp33 = -45.0 * sinPhi * cosPhi * cosPhi;

  const x = -dp10 * g10 - dp11 * (g11 * Math.cos(lambda) + h11 * Math.sin(lambda))
    - dp20 * g20 - dp21 * (g21 * Math.cos(lambda) + h21 * Math.sin(lambda))
    - dp22 * (g22 * Math.cos(2 * lambda) + h22 * Math.sin(2 * lambda))
    - dp30 * g30 - dp31 * (g31 * Math.cos(lambda) + h31 * Math.sin(lambda))
    - dp32 * (g32 * Math.cos(2 * lambda) + h32 * Math.sin(2 * lambda))
    - dp33 * (g33 * Math.cos(3 * lambda) + h33 * Math.sin(3 * lambda));

  const y = (1.0 / cosPhi) * (
    p11 * (g11 * Math.sin(lambda) - h11 * Math.cos(lambda))
    + p21 * (g21 * Math.sin(lambda) - h21 * Math.cos(lambda))
    + p22 * (g22 * Math.sin(2 * lambda) - h22 * Math.cos(2 * lambda))
    + p31 * (g31 * Math.sin(lambda) - h31 * Math.cos(lambda))
    + p32 * (g32 * Math.sin(2 * lambda) - h32 * Math.cos(2 * lambda))
    + p33 * (g33 * Math.sin(3 * lambda) - h33 * Math.cos(3 * lambda))
  );

  return Math.atan2(y, x) * 180 / Math.PI;
}
