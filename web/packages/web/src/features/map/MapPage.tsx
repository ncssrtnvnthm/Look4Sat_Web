import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { TopBar } from '../../presentation/Components';
import { useMapStore } from './mapStore';
import { useSettingsStore } from '../../data/stores';
import { SunTerminator } from './SunTerminator';
import { noradUrl } from '../../lib/noradUrl';
import styles from './MapPage.module.css';
import 'leaflet/dist/leaflet.css';

const stationIcon = L.divIcon({
  className: styles.stationMarker,
  html: '<div style="width:12px;height:12px;background:#4fc3f7;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px #4fc3f7;"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const sunIcon = L.divIcon({
  className: styles.sunMarker,
  html: '<div style="width:10px;height:10px;background:#ffb74d;border-radius:50%;box-shadow:0 0 8px #ffb74d;"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const moonIcon = L.divIcon({
  className: styles.moonMarker,
  html: '<div style="width:8px;height:8px;background:#bdbdbd;border-radius:50%;box-shadow:0 0 4px #fff;"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

const satIcon = L.divIcon({
  className: styles.satMarker,
  html: '<div style="width:14px;height:14px;background:#4fc3f7;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #4fc3f7,0 0 16px rgba(79,195,247,0.4);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const EARTH_RADIUS_M = 6_371_000;

/** Ground footprint radius (meters) for a satellite at the given altitude (km). */
function footprintRadius(altKm: number | null): number {
  if (altKm == null || !Number.isFinite(altKm) || altKm <= 0) return 800_000;
  const r = EARTH_RADIUS_M;
  const h = altKm * 1000;
  const theta = Math.acos(Math.min(1, r / (r + h)));
  return r * theta;
}

function StationClickHandler({
  active,
  onSetPosition,
}: {
  active: boolean;
  onSetPosition: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) {
        onSetPosition(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

/** Keep the map centered on the station whenever it changes (react-leaflet's center prop is initial-only). */
function MapCenterSync({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [map, center[0], center[1]]);
  return null;
}

export function MapPage() {
  const store = useMapStore();
  const { selectedSat, sunLat, sunLon, moonLat, moonLon, allSatellites, selectedIndex, satLat, satLon } = store;
  const stationPosition = useSettingsStore((s) => s.stationPosition);
  const setStationPosition = useSettingsStore((s) => s.setStationPosition);
  const lightTheme = useSettingsStore((s) => s.otherSettings.stateOfLightTheme);
  const [pinning, setPinning] = useState(false);

  const handleSetPosition = useCallback(
    (lat: number, lon: number) => {
      // Preserve the configured altitude — only the lat/lon are picked from the map.
      const altitude = useSettingsStore.getState().stationPosition.altitude;
      setStationPosition({ latitude: lat, longitude: lon, altitude });
      setPinning(false);
    },
    [setStationPosition],
  );

  useEffect(() => {
    store.initMap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    store.startTicking();
    return () => store.stopTicking();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const station: [number, number] = [stationPosition.latitude, stationPosition.longitude];
  const positionSet = stationPosition.latitude !== 0 || stationPosition.longitude !== 0;
  const center: [number, number] = positionSet ? station : [20, 0];

  // OSM standard tiles — free, no API key required (CARTO basemaps now require one).
  // Dark theme is achieved with a CSS invert filter on the tile pane (see MapPage.module.css).
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  return (
    <div className={`${styles.page} ${pinning ? styles.pinning : ''}`}>
      <TopBar
        title={selectedSat?.name ?? 'Map'}
        actions={
          <button
            className={`${styles.actionBtn} ${pinning ? styles.actionBtnActive : ''}`}
            onClick={() => setPinning((p) => !p)}
          >
            📍 {pinning ? 'Tap map…' : 'Drop Pin'}
          </button>
        }
      />

      {allSatellites.length > 1 && (
        <div className={styles.satToolbar}>
          <button
            className={styles.actionBtn}
            onClick={store.selectPrev}
            aria-label="Previous satellite"
          >
            ◀
          </button>
          <span className={styles.satIndex}>
            {selectedIndex + 1}/{allSatellites.length}
          </span>
          <button
            className={styles.actionBtn}
            onClick={store.selectNext}
            aria-label="Next satellite"
          >
            ▶
          </button>
          <select
            className={styles.satSelect}
            value={selectedIndex}
            onChange={(e) => store.selectSatellite(Number(e.target.value))}
          >
            {allSatellites.map((sat, i) => (
              <option key={sat.catnum} value={i}>
                {sat.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.mapContainer}>
        <MapContainer
          center={center}
          zoom={3}
          className={`${styles.map} ${lightTheme ? '' : styles.mapDark}`}
          zoomControl={true}
          attributionControl={true}
        >
          <MapCenterSync center={center} />
          <TileLayer
            attribution={tileAttr}
            url={tileUrl}
          />

          {/* Click to set station position */}
          <StationClickHandler active={pinning} onSetPosition={handleSetPosition} />

          {/* Day/night illumination overlay */}
          <SunTerminator />

          {/* Station position */}
          <Marker position={station} icon={stationIcon}>
            <Popup>
              📍 Station<br />
              {stationPosition.latitude.toFixed(3)}°, {stationPosition.longitude.toFixed(3)}°
            </Popup>
          </Marker>

          {/* Sun sub-point */}
          {isFinite(sunLat) && isFinite(sunLon) && (
            <Marker position={[sunLat, sunLon]} icon={sunIcon}>
              <Popup>☀️ Sun</Popup>
            </Marker>
          )}

          {/* Moon sub-point */}
          {isFinite(moonLat) && isFinite(moonLon) && (
            <Marker position={[moonLat, moonLon]} icon={moonIcon}>
              <Popup>🌙 Moon</Popup>
            </Marker>
          )}

          {/* Satellite ground track */}
          {store.trackSegments.map((segment, i) => (
            <Polyline
              key={`track-${i}`}
              positions={segment}
              pathOptions={{ color: '#4fc3f7', weight: 2, opacity: 0.6 }}
            />
          ))}

          {/* Satellite position + footprint */}
          {selectedSat && satLat != null && satLon != null && isFinite(satLat) && isFinite(satLon) && (
            <>
              <Marker position={[satLat, satLon]} icon={satIcon}>
                <Popup>
                  🛰️ {selectedSat.name}<br />
                  NORAD: <a href={noradUrl(selectedSat.catnum)} target="_blank" rel="noopener noreferrer">#{selectedSat.catnum}</a><br />
                  Alt: {store.satAlt?.toFixed(0) ?? '?'} km
                </Popup>
              </Marker>
              <Circle
                center={[satLat, satLon]}
                radius={footprintRadius(store.satAlt)}
                pathOptions={{ color: '#4fc3f7', fillOpacity: 0.03, weight: 1 }}
              />
            </>
          )}
        </MapContainer>
      </div>

      {/* Satellite info bar */}
      {selectedSat && (
        <div className={styles.satInfo}>
          <span>🛰️ {selectedSat.name}</span>
          <a
            href={noradUrl(selectedSat.catnum)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.noradLink}
          >
            #{selectedSat.catnum}
          </a>
          <span>{selectedSat.orbitalPeriod.toFixed(0)} min orbit</span>
        </div>
      )}
    </div>
  );
}
