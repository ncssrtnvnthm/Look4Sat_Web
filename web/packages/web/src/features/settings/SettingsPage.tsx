import { useState, useEffect } from 'react';
import { TopBar } from '../../presentation/Components';
import { useSettingsStore } from '../../data/stores';
import { fetchAndStoreSatelliteData, fetchTransceivers, SATELLITE_DATA_URLS } from '../../data/satelliteData';
import { db } from '../../data/database';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const store = useSettingsStore();
  const { otherSettings, stationPosition, databaseState } = store;
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
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
      if (allResult.inserted === 0 && !allResult.upToDate) {
        setUpdateMsg('No new satellites found.');
        setUpdating(false);
        return;
      }

      // Step 2: Fetch each Celestrak category to tag satellites with their groups.
      // Skip "All", "Other", and non-Celestrak sources (Amsat, Classified, McCants, R4UAB).
      const celestrakCategories = Object.entries(SATELLITE_DATA_URLS).filter(
        ([key, url]) =>
          key !== 'All' &&
          key !== 'Other' &&
          url.includes('celestrak.org') &&
          url !== '',
      );

      let tagged = 0;
      for (let i = 0; i < celestrakCategories.length; i++) {
        const [cat, url] = celestrakCategories[i];
        setUpdateMsg(`Tagging ${cat} (${i + 1}/${celestrakCategories.length})...`);
        try {
          const result = await fetchAndStoreSatelliteData([url], cat);
          if (result.inserted > 0) tagged += result.inserted;
        } catch {
          // Skip categories that fail (rate limits, etc.)
        }
      }

      setUpdateMsg(
        `${allResult.inserted} satellites updated, ${tagged} category tags applied from ${celestrakCategories.length} groups.`,
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
              if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                  (pos) =>
                    store.setStationPosition({
                      latitude: pos.coords.latitude,
                      longitude: pos.coords.longitude,
                      altitude: pos.coords.altitude ?? 0,
                    }),
                  (err) => console.warn('Geolocation error:', err),
                );
              }
            }}
          >
            📍 Get GPS Position
          </button>
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
                  if (!isNaN(lat) && !isNaN(lon)) {
                    store.setStationPosition({ latitude: lat, longitude: lon, altitude: alt });
                  }
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
              .filter(([key, url]) => url.includes('celestrak.org'))
              .map(([cat, url]) => (
                <button
                  key={cat}
                  className={styles.smallBtn}
                  disabled={updating}
                  onClick={async () => {
                    setUpdating(true);
                    setUpdateMsg(null);
                    try {
                      const result = await fetchAndStoreSatelliteData([url], cat);
                      setUpdateMsg(`${cat}: ${result.message}`);
                    } catch (e: any) {
                      setUpdateMsg(`${cat}: ${e.message}`);
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
            { label: 'Auto-update data', key: 'stateOfAutoUpdate' as const },
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
