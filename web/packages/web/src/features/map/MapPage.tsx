import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { TopBar } from '../../presentation/Components';
import { useMapStore } from './mapStore';
import { useSettingsStore } from '../../data/stores';
import { SunTerminator } from './SunTerminator';
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

export function MapPage() {
  const store = useMapStore();
  const { selectedSat, sunLat, sunLon, moonLat, moonLon, allSatellites, selectedIndex, satLat, satLon } = store;
  const stationPosition = useSettingsStore((s) => s.stationPosition);
  const setStationPosition = useSettingsStore((s) => s.setStationPosition);
  const lightTheme = useSettingsStore((s) => s.otherSettings.stateOfLightTheme);
  const [pinning, setPinning] = useState(false);

  const handleSetPosition = useCallback(
    (lat: number, lon: number) => {
      setStationPosition({ latitude: lat, longitude: lon, altitude: 0 });
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

  // Force Leaflet to recalculate size after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const container = document.querySelector('.leaflet-container') as HTMLElement | null;
      if (container) {
        container.style.display = 'none';
        void container.offsetHeight;
        container.style.display = '';
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const station: [number, number] = [stationPosition.latitude, stationPosition.longitude];
  const center: [number, number] = selectedSat
    ? [stationPosition.latitude, stationPosition.longitude]
    : [20, 0];

  const tileUrl = lightTheme
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const tileAttr = '&copy; <a href="https://carto.com/">CARTO</a> | <a href="https://www.openstreetmap.org/copyright">OSM</a>';

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
          <button className={styles.actionBtn} onClick={store.selectPrev}>◀</button>
          <span className={styles.satIndex}>
            {selectedIndex + 1}/{allSatellites.length}
          </span>
          <button className={styles.actionBtn} onClick={store.selectNext}>▶</button>
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
          className={styles.map}
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            key={lightTheme ? 'light' : 'dark'}
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
                  NORAD: <a href={`https://www.n2yo.com/satellite/?s=${selectedSat.catnum}`} target="_blank" rel="noopener noreferrer">#{selectedSat.catnum}</a><br />
                  Alt: {store.satAlt?.toFixed(0) ?? '?'} km
                </Popup>
              </Marker>
              <Circle
                center={[satLat, satLon]}
                radius={800000}
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
            href={`https://www.n2yo.com/satellite/?s=${selectedSat.catnum}`}
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
