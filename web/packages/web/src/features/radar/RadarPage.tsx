import { useEffect } from 'react';
import { RadarView } from './RadarView';
import { TopBar, TimerRow, IconCard } from '../../presentation/Components';
import { useRadarStore } from './radarStore';
import styles from './RadarPage.module.css';

function noradUrl(catNum: number) {
  return `https://www.n2yo.com/satellite/?s=${catNum}`;
}

/** Format Hz to MHz with 3 decimal places. */
function formatMHz(hz: number | null | undefined): string {
  if (hz == null) return '—';
  return (hz / 1e6).toFixed(3) + ' MHz';
}

export function RadarPage() {
  const store = useRadarStore();

  useEffect(() => {
    store.startRadar();
    return () => store.stopRadar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { currentPass, orbitalPos, satTrack, sunPosition, moonPosition } = store;
  const sats = store._satellites;
  const satIdx = store._satIndex;
  const radios = store._radios;
  const activeRadios = radios.filter((r) => r.downlinkLow != null || r.uplinkLow != null);

  return (
    <div className={styles.page}>
      <TopBar
        title={
          currentPass ? (
            <>
              {currentPass.name}{' '}
              <a
                href={noradUrl(currentPass.catNum)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.noradLink}
              >
                #{currentPass.catNum}
              </a>
            </>
          ) : (
            'Radar'
          )
        }
        actions={
          <>
            <button className={styles.actionBtn} onClick={store.toggleSweep}>
              {store.shouldShowSweep ? 'Sweep On' : 'Sweep Off'}
            </button>
            <button className={styles.actionBtn} onClick={store.toggleCompass}>
              {store.shouldUseCompass ? 'Compass' : 'Fixed'}
            </button>
            {sats.length > 1 && (
              <select
                className={styles.satSelect}
                value={satIdx}
                onChange={(e) => store.selectSatellite(Number(e.target.value))}
              >
                {sats.map((sat, i) => (
                  <option key={sat.catnum} value={i}>
                    {sat.name}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {/* Timer */}
      <div className={styles.timerSection}>
        <TimerRow
          time={store.currentTime}
          isAos={store.isTimeAos}
          label={store.isTimeAos ? 'AOS in' : 'LOS in'}
        />
      </div>

      {/* Polar radar */}
      <div className={styles.radarContainer}>
        <RadarView
          satellitePos={orbitalPos}
          track={satTrack}
          compassAzimuth={store.orientationValues[0]}
          compassElevation={store.orientationValues[1]}
          shouldShowSweep={store.shouldShowSweep}
          shouldUseCompass={store.shouldUseCompass}
          sunPosition={sunPosition}
          moonPosition={moonPosition}
        />
      </div>

      <div className={styles.bottomContent}>
        {/* Info cards — always visible */}
        <div className={styles.infoCards}>
          <IconCard icon="↗" label="Azimuth" value={orbitalPos ? `${orbitalPos.azimuth.toFixed(1)}°` : '—'} />
          <IconCard icon="↑" label="Elevation" value={orbitalPos ? `${orbitalPos.elevation.toFixed(1)}°` : '—'} />
          <IconCard icon="◎" label="Range" value={orbitalPos ? `${orbitalPos.distance.toFixed(0)} km` : '—'} />
          <IconCard icon="⌬" label="Altitude" value={orbitalPos ? `${orbitalPos.altitude.toFixed(0)} km` : '—'} />
        </div>

        {/* Radio frequencies — all transponders/beacons */}
        {activeRadios.length > 0 && (
          <div className={styles.radioList}>
            {activeRadios.map((r) => (
              <div key={r.uuid} className={styles.radioRow}>
                <div className={styles.radioDesc}>{r.description || 'Transponder'}</div>
                <div className={styles.radioFreqs}>
                  {r.downlinkLow != null && (
                    <span className={styles.radioFreq}>▼ {formatMHz(r.downlinkLow)}</span>
                  )}
                  {r.uplinkLow != null && (
                    <span className={styles.radioFreq}>▲ {formatMHz(r.uplinkLow)}</span>
                  )}
                  {r.mode && (
                    <span className={styles.radioMode}>{r.mode}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
