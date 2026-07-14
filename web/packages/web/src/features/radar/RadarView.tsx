import { useRef, useEffect, useCallback } from 'react';
import type { OrbitalPos, SunPosition, MoonPosition } from '../../domain/types';

// ── Constants ──

const DEG_TO_RAD = Math.PI / 180;
const CIRCLES = 3;
const STROKE_WIDTH = 2;
const SWEEP_DURATION_MS = 8000;
const ELEVATION_RINGS = [30, 60, 90];

interface RadarViewProps {
  satellitePos: OrbitalPos | null;
  track: OrbitalPos[];
  compassAzimuth: number;
  compassElevation: number;
  shouldShowSweep: boolean;
  shouldUseCompass: boolean;
  sunPosition?: SunPosition | null;
  moonPosition?: MoonPosition | null;
}

export function RadarView({
  satellitePos,
  track,
  compassAzimuth,
  compassElevation,
  shouldShowSweep,
  shouldUseCompass,
  sunPosition,
  moonPosition,
}: RadarViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const sweepAngleRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width * dpr;
    const height = rect.height * dpr;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 32 * dpr;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    // Rotate for compass if enabled
    if (shouldUseCompass) {
      ctx.translate(centerX, centerY);
      ctx.rotate(-compassAzimuth * DEG_TO_RAD);
      ctx.translate(-centerX, -centerY);
    }

    // ── Draw polar grid ──
    ctx.strokeStyle = 'rgba(160, 160, 176, 0.3)';
    ctx.lineWidth = STROKE_WIDTH * dpr;
    ctx.fillStyle = 'rgba(160, 160, 176, 0.05)';

    for (let i = 1; i <= CIRCLES; i++) {
      const r = (radius / CIRCLES) * i;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Elevation labels
      const elev = ELEVATION_RINGS[i - 1];
      ctx.fillStyle = 'rgba(160, 160, 176, 0.6)';
      ctx.font = `${10 * dpr}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`${elev}°`, centerX - 4 * dpr, centerY - r + 14 * dpr);
      ctx.fillStyle = 'rgba(160, 160, 176, 0.05)';
    }

    // Crosshairs
    ctx.strokeStyle = 'rgba(160, 160, 176, 0.15)';
    ctx.beginPath();
    ctx.moveTo(centerX - radius, centerY);
    ctx.lineTo(centerX + radius, centerY);
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX, centerY + radius);
    ctx.stroke();

    // Cardinal direction labels (N, E, S, W)
    const dirs = [
      { label: 'N', angle: 0 },
      { label: 'E', angle: 90 },
      { label: 'S', angle: 180 },
      { label: 'W', angle: 270 },
    ];
    ctx.fillStyle = 'rgba(224, 224, 224, 0.8)';
    ctx.font = `bold ${11 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { label, angle } of dirs) {
      const rad = (angle - 90) * DEG_TO_RAD;
      const lx = centerX + (radius + 14 * dpr) * Math.cos(rad);
      const ly = centerY + (radius + 14 * dpr) * Math.sin(rad);
      ctx.fillText(label, lx, ly);
    }

    // ── Sweep line animation ──
    if (shouldShowSweep) {
      sweepAngleRef.current =
        (sweepAngleRef.current + (360 * 16) / SWEEP_DURATION_MS) % 360;
      const sweepRad = (sweepAngleRef.current - 90) * DEG_TO_RAD;
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.25)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + radius * Math.cos(sweepRad),
        centerY + radius * Math.sin(sweepRad),
      );
      ctx.stroke();
    }

    // ── Satellite track ──
    if (track.length > 1) {
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.4)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      let firstPoint = true;
      for (const pos of track) {
        const azRad = (pos.azimuth - 90) * DEG_TO_RAD;
        const dist = ((90 - pos.elevation) / 90) * radius;
        const px = centerX + dist * Math.cos(azRad);
        const py = centerY + dist * Math.sin(azRad);
        if (firstPoint) {
          ctx.moveTo(px, py);
          firstPoint = false;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }

    // ── Current satellite position ──
    if (satellitePos) {
      const azRad = (satellitePos.azimuth - 90) * DEG_TO_RAD;
      const dist = ((90 - Math.max(satellitePos.elevation, 0)) / 90) * radius;
      const sx = centerX + dist * Math.cos(azRad);
      const sy = centerY + dist * Math.sin(azRad);

      // Glow
      ctx.fillStyle = 'rgba(79, 195, 247, 0.2)';
      ctx.beginPath();
      ctx.arc(sx, sy, 12 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Dot
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#e0e0e0';
      ctx.font = `${10 * dpr}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(
        `${satellitePos.azimuth.toFixed(1)}° / ${satellitePos.elevation.toFixed(1)}°`,
        sx + 10 * dpr,
        sy - 10 * dpr,
      );
    }

    // ── Sun marker ──
    if (sunPosition) {
      const sunRad = (sunPosition.azimuth - 90) * DEG_TO_RAD;
      const sunDist = ((90 - Math.max(sunPosition.elevation, 0)) / 90) * radius;
      const sunX = centerX + sunDist * Math.cos(sunRad);
      const sunY = centerY + sunDist * Math.sin(sunRad);
      ctx.fillStyle = '#ffb74d';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Moon marker ──
    if (moonPosition) {
      const moonRad = (moonPosition.azimuth - 90) * DEG_TO_RAD;
      const moonDist = ((90 - Math.max(moonPosition.elevation, 0)) / 90) * radius;
      const moonX = centerX + moonDist * Math.cos(moonRad);
      const moonY = centerY + moonDist * Math.sin(moonRad);
      ctx.fillStyle = '#bdbdbd';
      ctx.beginPath();
      ctx.arc(moonX, moonY, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    animFrameRef.current = requestAnimationFrame(draw);
  }, [satellitePos, track, compassAzimuth, compassElevation, shouldShowSweep, shouldUseCompass, sunPosition, moonPosition]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  );
}
