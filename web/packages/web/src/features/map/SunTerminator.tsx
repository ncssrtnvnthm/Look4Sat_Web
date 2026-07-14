import { useMemo } from 'react';
import { Polygon } from 'react-leaflet';
import { useMapStore } from './mapStore';

/**
 * Night-side illumination overlay.
 * Generates polygons for 3 world copies so the terminator wraps
 * correctly when the map is zoomed out enough to show multiple worlds.
 */
export function SunTerminator() {
  const sunLat = useMapStore((s) => s.sunLat);
  const sunLon = useMapStore((s) => s.sunLon);

  const polygons = useMemo(() => {
    if (!isFinite(sunLat) || !isFinite(sunLon)) return null;

    // Generate for 3 world copies: left, center, right
    const offsets = [-360, 0, 360];
    return offsets.map((offset) => buildNightPolygon(sunLat, sunLon, offset));
  }, [sunLat, sunLon]);

  if (!polygons) return null;

  return (
    <>
      {polygons.map((coords, i) => (
        <Polygon
          key={i}
          positions={coords}
          pathOptions={{
            color: 'transparent',
            fillColor: '#000',
            fillOpacity: 0.3,
            interactive: false,
          }}
        />
      ))}
    </>
  );
}

/** Build the night polygon for a given longitude offset. */
function buildNightPolygon(
  sunLat: number,
  sunLon: number,
  lngOffset: number,
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const sunLatR = sunLat * toRad;
  const tanSunLat = Math.tan(sunLatR);

  // Which pole is dark?
  // dot(north pole, sun) = sin(90)*sin(sunLat) = sin(sunLat)
  const nightIsSouth = sunLat > 0;

  // Generate terminator for lng = -180 + offset to 180 + offset
  const points: [number, number][] = [];
  for (let i = 0; i <= 360; i++) {
    const lng = lngOffset + (-180 + (i / 360) * 360);
    const dLon = (lng - sunLon) * toRad;
    let lat: number;
    if (Math.abs(tanSunLat) < 1e-9) {
      lat = Math.cos(dLon) > 0 ? 90 : -90;
    } else {
      lat = Math.atan(-Math.cos(dLon) / tanSunLat) * toDeg;
    }
    lat = Math.max(-90, Math.min(90, lat));
    points.push([lat, lng]);
  }

  // Build polygon: terminator + wrap along invisible map edge
  const poly: [number, number][] = [];
  if (nightIsSouth) {
    for (const p of points) poly.push([p[0], p[1]]);
    poly.push([-85, lngOffset + 180]);
    poly.push([-85, lngOffset - 180]);
  } else {
    for (let i = points.length - 1; i >= 0; i--) {
      poly.push([points[i][0], points[i][1]]);
    }
    poly.push([85, lngOffset - 180]);
    poly.push([85, lngOffset + 180]);
  }

  return poly;
}
