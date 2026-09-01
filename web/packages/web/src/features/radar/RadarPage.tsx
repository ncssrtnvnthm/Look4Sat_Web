import { useEffect } from 'react';
import { RadarView } from './RadarView';
import { TopBar, TimerRow, IconCard } from '../../presentation/Components';
import { useRadarStore } from './radarStore';
import { noradUrl } from '../../lib/noradUrl';
import { dopplerShiftFreq } from '../../lib/doppler';
import styles from './RadarPage.module.css';
import buttons from '../../presentation/buttons.module.css';

/** Format Hz to MHz with 3 decimal places. */
function formatMHz(hz: number | null | undefined): string {
  if (hz == null) return '—';
  return (hz / 1e6).toFixed(3) + ' MHz';
}

/** Format a small frequency difference in Hz (e.g. doppler shift). */
function formatHz(hz: number): string {
  const abs = Math.abs(hz);
  if (abs >= 1000) return (hz / 1000).toFixed(1) + ' kHz';
  return hz.toFixed(0) + ' Hz';
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
            <button className={buttons.actionBtn} onClick={store.toggleSweep}>
              {store.shouldShowSweep ? 'Sweep On' : 'Sweep Off'}
            </button>
            <button className={buttons.actionBtn} onClick={store.toggleCompass}>
              {store.shouldUseCompass ? 'Compass' : 'Fixed'}
            </button>
            {sats.length > 1 && (
              <select
                className={buttons.actionSelect}
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

      {sats.length === 0 && (
        <div className={styles.emptyState}>
          No satellites selected. Go to the Satellites page, choose what to track, and save.
        </div>
      )}

      {store.compassMessage && (
        <div className={styles.compassMsg}>{store.compassMessage}</div>
      )}

      <div className={styles.bottomContent}>
        {/* Info cards — always visible */}
        <div className={styles.infoCards}>
          <IconCard icon="↗" label="Azimuth" value={orbitalPos ? `${orbitalPos.azimuth.toFixed(1)}°` : '—'} />
          <IconCard icon="↑" label="Elevation" value={orbitalPos ? `${orbitalPos.elevation.toFixed(1)}°` : '—'} />
          <IconCard icon="◎" label="Range" value={orbitalPos ? `${orbitalPos.distance.toFixed(0)} km` : '—'} />
          <IconCard icon="⌬" label="Altitude" value={orbitalPos ? `${orbitalPos.altitude.toFixed(0)} km` : '—'} />
        </div>

        {/* Radio frequencies — doppler-shifted transponders/beacons */}
        {activeRadios.length > 0 && (
          <div className={styles.radioList}>
            {activeRadios.map((r) => {
              const rangeRate = orbitalPos?.distanceRate ?? 0;
              const downlink = r.downlinkLow != null ? dopplerShiftFreq(r.downlinkLow, rangeRate, false) : null;
              const uplink = r.uplinkLow != null ? dopplerShiftFreq(r.uplinkLow, rangeRate, true) : null;
              const downlinkTip = r.downlinkLow != null && orbitalPos
                ? `base ${formatMHz(r.downlinkLow)} · Δ${formatHz(downlink! - r.downlinkLow)}`
                : undefined;
              const uplinkTip = r.uplinkLow != null && orbitalPos
                ? `base ${formatMHz(r.uplinkLow)} · Δ${formatHz(uplink! - r.uplinkLow)}`
                : undefined;
              return (
                <div key={r.uuid} className={styles.radioRow}>
                  <div className={styles.radioDesc}>{r.description || 'Transponder'}</div>
                  <div className={styles.radioFreqs}>
                    {downlink != null && (
                      <span className={styles.radioFreq} title={downlinkTip}>▼ {formatMHz(downlink)}</span>
                    )}
                    {uplink != null && (
                      <span className={styles.radioFreq} title={uplinkTip}>▲ {formatMHz(uplink)}</span>
                    )}
                    {r.mode && (
                      <span className={styles.radioMode}>{r.mode}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {orbitalPos && (
              <div className={styles.radioDoppler}>
                Doppler: {orbitalPos.distanceRate > 0 ? 'receding' : 'approaching'} (
                {formatHz(Math.abs(orbitalPos.distanceRate * 1000))}/s)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
