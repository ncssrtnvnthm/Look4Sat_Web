import { useState, useEffect } from 'react';
import { TopBar } from '../../presentation/Components';
import { useSettingsStore } from '../../data/stores';
import { fetchAndStoreSatelliteData, fetchTransceivers, fetchAndTagCategories, SATELLITE_DATA_URLS } from '../../data/satelliteData';
import { db } from '../../data/database';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const store = useSettingsStore();
  const { otherSettings, stationPosition, databaseState } = store;
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [manualLat, setManualLat] = useState(stationPosition.latitude.toString());
  const [manualLon, setManualLon] = useState(stationPosition.longitude.toString());
  const [manualAlt, setManualAlt] = useState(stationPosition.altitude.toString());

  // Refresh DB counts on mount
  useEffect(() => {
    (async () => {
      const [satCount, radioCount] = await Promise.all([
        db.entries.count(),
        db.radios.count(),
      ]);
      store.updateDatabaseState({
        numberOfSatellites: satCount,
        numberOfRadios: radioCount,
        updateTimestamp: databaseState.updateTimestamp,
      });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateMsg('Downloading all satellites...');
    try {
      // Step 1: Download all active satellites (bulk orbital data)
      const allResult = await fetchAndStoreSatelliteData();
      if (allResult.errors.length > 0) {
        setUpdateMsg(`Update finished with ${allResult.errors.length} error(s): ${allResult.errors[0]}`);
        setUpdating(false);
        return;
      }
      if (allResult.inserted === 0 && !allResult.upToDate) {
        setUpdateMsg('No new satellites found.');
        setUpdating(false);
        return;
      }

      // Step 2: Tag satellites with their Celestrak groups, downloading in
      // parallel and skipping groups that are already tagged.
      // Skip "All", "Other", and non-Celestrak sources (Amsat, Classified, McCants, R4UAB).
      const celestrakCategories = Object.entries(SATELLITE_DATA_URLS).filter(
        ([key, url]) =>
          key !== 'All' &&
          key !== 'Other' &&
          url.includes('celestrak.org') &&
          url !== '',
      );

      const tagResult = await fetchAndTagCategories(celestrakCategories, 4, (done, total, current) => {
        setUpdateMsg(`Tagging satellites (${done}/${total})… ${current}`);
      });

      setUpdateMsg(
        `${allResult.inserted} satellites updated, ${tagResult.tagged} category tags applied` +
          ` (${tagResult.skipped} already tagged, ${tagResult.errors} group fetch(es) failed).`,
      );
    } catch {
      setUpdateMsg('Update failed. Check console.');
    }
    setUpdating(false);
  };

  const handleFetchTransceivers = async () => {
    setUpdating(true);
    setUpdateMsg('Downloading transceiver data...');
    try {
      const radios = await fetchTransceivers();
      setUpdateMsg(`${radios.length} transceivers loaded.`);
      const [satCount, radioCount] = await Promise.all([db.entries.count(), db.radios.count()]);
      store.updateDatabaseState({
        numberOfSatellites: satCount,
        numberOfRadios: radioCount,
        updateTimestamp: Date.now(),
      });
    } catch {
      setUpdateMsg('Transceiver fetch failed.');
    }
    setUpdating(false);
  };

  return (
    <div className={styles.page}>
      <TopBar title="Settings" />

      <div className={styles.content}>
        {/* Position Section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Station Position</h3>
          <div className={styles.posInfo}>
            <span>Lat: {stationPosition.latitude.toFixed(4)}°</span>
            <span>Lon: {stationPosition.longitude.toFixed(4)}°</span>
            <span>Alt: {stationPosition.altitude.toFixed(0)} m</span>
          </div>
          <button
            className={styles.btn}
            onClick={() => {
              if (!('geolocation' in navigator)) {
                setGpsMsg('Geolocation is not supported on this device/browser.');
                return;
              }
              if (!window.isSecureContext) {
                setGpsMsg('Geolocation requires a secure context (HTTPS or localhost). Open the site over HTTPS.');
                return;
              }
              setGpsMsg('Getting GPS position...');
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  store.setStationPosition({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    altitude: pos.coords.altitude ?? 0,
                  });
                  setManualLat(pos.coords.latitude.toFixed(6));
                  setManualLon(pos.coords.longitude.toFixed(6));
                  setManualAlt(String(Math.round(pos.coords.altitude ?? 0)));
                  setGpsMsg(
                    `Position set: ${pos.coords.latitude.toFixed(4)}°, ${pos.coords.longitude.toFixed(4)}°`,
                  );
                },
                (err) => {
                  const reasons: Record<number, string> = {
                    1: 'Permission denied. Enable location access for this site in your browser settings.',
                    2: 'Position unavailable. Try enabling GPS/Wi-Fi or moving to a clearer area.',
                    3: 'Timed out getting a fix. Try again.',
                  };
                  setGpsMsg(`GPS error: ${reasons[err.code] ?? err.message}`);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
              );
            }}
          >
            📍 Get GPS Position
          </button>
          {gpsMsg && (
            <div className={styles.updateMsg} style={{ marginTop: 8 }}>
              {gpsMsg}
            </div>
          )}
          <div className={styles.manualPos}>
            <span className={styles.manualPosLabel}>Or enter manually:</span>
            <div className={styles.manualPosRow}>
              <input
                type="number"
                className={styles.posInput}
                placeholder="Latitude"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
                step="any"
              />
              <input
                type="number"
                className={styles.posInput}
                placeholder="Longitude"
                value={manualLon}
                onChange={(e) => setManualLon(e.target.value)}
                step="any"
              />
              <input
                type="number"
                className={styles.posInput}
                placeholder="Altitude (m)"
                value={manualAlt}
                onChange={(e) => setManualAlt(e.target.value)}
                step="any"
              />
              <button
                className={styles.posApplyBtn}
                onClick={() => {
                  const lat = parseFloat(manualLat);
                  const lon = parseFloat(manualLon);
                  const alt = parseFloat(manualAlt) || 0;
                  if (isNaN(lat) || isNaN(lon)) {
                    setGpsMsg('Enter valid numeric latitude and longitude.');
                    return;
                  }
                  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    setGpsMsg('Latitude must be between -90 and 90, longitude between -180 and 180.');
                    return;
                  }
                  store.setStationPosition({ latitude: lat, longitude: lon, altitude: alt });
                  setGpsMsg(null);
                }}
              >
                Set
              </button>
            </div>
          </div>
          <p className={styles.posHint}>
            💡 You can also drop a pin on the <strong>Map</strong> page to set your position visually.
          </p>
        </section>

        {/* Data Section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Satellite Data</h3>
          <div className={styles.posInfo}>
            <span>{databaseState.numberOfSatellites} satellites</span>
            <span>{databaseState.numberOfRadios} transceivers</span>
            <span>
              Updated:{' '}
              {databaseState.updateTimestamp
                ? new Date(databaseState.updateTimestamp).toLocaleDateString()
                : 'never'}
            </span>
          </div>
          <button
            className={styles.btn}
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? '⏳ Updating...' : '⬇ Update from Celestrak'}
          </button>
          <button
            className={styles.btn}
            onClick={handleFetchTransceivers}
            disabled={updating}
            style={{ marginTop: 8 }}
          >
            {updating ? '⏳ Loading...' : '📻 Fetch Transceivers'}
          </button>
          {updateMsg && (
            <div className={styles.updateMsg}>{updateMsg}</div>
          )}

          <div className={styles.categoryButtons}>
            <span className={styles.categoryLabel}>Celestrak groups:</span>
            {Object.entries(SATELLITE_DATA_URLS)
              .filter(([, url]) => url.includes('celestrak.org'))
              .map(([cat, url]) => (
                <button
                  key={cat}
                  className={styles.smallBtn}
                  disabled={updating}
                  onClick={async () => {
                    setUpdating(true);
                    setUpdateMsg(null);
                    const result = await fetchAndStoreSatelliteData([url], cat);
                    if (result.errors.length > 0) {
                      setUpdateMsg(`${cat}: ${result.errors[0]}`);
                    } else {
                      setUpdateMsg(`${cat}: ${result.message}`);
                    }
                    setUpdating(false);
                  }}
                >
                  {cat}
                </button>
              ))}
          </div>
        </section>

        {/* Toggles Section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Preferences</h3>
          {[
            { label: 'UTC Time', key: 'stateOfUtc' as const },
            { label: 'Radar sweep', key: 'stateOfSweep' as const },
            { label: 'Use compass', key: 'stateOfSensors' as const },
            { label: 'Light theme', key: 'stateOfLightTheme' as const },
            { label: 'Night mode (red filter)', key: 'stateOfNightMode' as const },
          ].map(({ label, key }) => (
            <label key={key} className={styles.toggle}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={otherSettings[key]}
                onChange={(e) =>
                  store.updateOtherSettings((s) => ({
                    ...s,
                    [key]: e.target.checked,
                  }))
                }
              />
            </label>
          ))}

          {/* Time offset slider */}
          <div className={styles.timeOffset}>
            <div className={styles.timeOffsetHeader}>
              <span>Time offset</span>
              <span className={styles.timeOffsetValue}>
                {(otherSettings.timeOffsetMinutes ?? 0) === 0
                  ? 'Now'
                  : `${(otherSettings.timeOffsetMinutes ?? 0) > 0 ? '+' : ''}${Math.floor((otherSettings.timeOffsetMinutes ?? 0) / 60)}h${Math.abs(otherSettings.timeOffsetMinutes ?? 0) % 60 ? ` ${String(Math.abs(otherSettings.timeOffsetMinutes ?? 0) % 60).padStart(2, '0')}m` : ''}`}
              </span>
            </div>
            <input
              type="range"
              min="-1440"
              max="1440"
              step="15"
              value={otherSettings.timeOffsetMinutes ?? 0}
              onChange={(e) =>
                store.updateOtherSettings((s) => ({
                  ...s,
                  timeOffsetMinutes: Number(e.target.value),
                }))
              }
              className={styles.timeOffsetSlider}
            />
            {(otherSettings.timeOffsetMinutes ?? 0) !== 0 && (
              <button
                className={styles.resetBtn}
                onClick={() =>
                  store.updateOtherSettings((s) => ({
                    ...s,
                    timeOffsetMinutes: 0,
                  }))
                }
              >
                Reset to now
              </button>
            )}
          </div>
        </section>

        {/* About */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>About</h3>
          <div className={styles.aboutLinks}>
            <a
              href="https://github.com/rt-bishop/Look4Sat"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.aboutLink}
            >
              Original Look4Sat (Android)
            </a>
            <a
              href="https://github.com/ncssrtnvnthm/Look4Sat_Web"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.aboutLink}
            >
              Look4Sat Web (this project)
            </a>
          </div>
        </section>

        {/* Version */}
        <div className={styles.version}>
          Look4Sat Web v{store.appVersionName}
        </div>
      </div>
    </div>
  );
}
