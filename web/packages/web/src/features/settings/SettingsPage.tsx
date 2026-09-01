import { useState, useEffect, useRef } from 'react';
import { TopBar } from '../../presentation/Components';
import { useSettingsStore } from '../../data/stores';
import {
  fetchAndStoreSatelliteData,
  fetchTransceivers,
  fetchAndTagCategories,
  importSatelliteFile,
  getEffectiveSatelliteSources,
  SATELLITE_DATA_URLS,
} from '../../data/satelliteData';
import type { SatelliteSource } from '../../domain/types';
import { db } from '../../data/database';
import styles from './SettingsPage.module.css';
import buttons from '../../presentation/buttons.module.css';

export function SettingsPage() {
  const store = useSettingsStore();
  const { otherSettings, stationPosition, databaseState, dataSourcesSettings } = store;
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateMsgIsError, setUpdateMsgIsError] = useState(false);
  const showMsg = (msg: string | null) => {
    setUpdateMsg(msg);
    setUpdateMsgIsError(false);
  };
  const showError = (msg: string) => {
    setUpdateMsg(msg);
    setUpdateMsgIsError(true);
  };
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [manualLat, setManualLat] = useState(stationPosition.latitude.toString());
  const [manualLon, setManualLon] = useState(stationPosition.longitude.toString());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom data-source editor (local drafts, saved explicitly).
  const [sources, setSources] = useState<SatelliteSource[]>(() =>
    (dataSourcesSettings.satelliteSources ?? []).length > 0
      ? (dataSourcesSettings.satelliteSources ?? [])
      : getEffectiveSatelliteSources().map(([name, url]) => ({ name, url })),
  );
  const [sourcesSaved, setSourcesSaved] = useState(false);
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
    showMsg('Downloading all satellites...');
    try {
      // Step 1: Download all active satellites (bulk orbital data)
      const allResult = await fetchAndStoreSatelliteData();
      if (allResult.errors.length > 0) {
        const firstError = allResult.errors[0];
        showError(
          `Update failed: ${firstError} ` +
            (firstError.includes('HTTP 5') || firstError.includes('HTTP 429')
              ? 'Celestrak may be temporarily unavailable — wait a minute and try again.'
              : 'Check the URL and your connection, then try again.'),
        );
        setUpdating(false);
        return;
      }
      if (allResult.inserted === 0 && !allResult.upToDate) {
        showMsg('No new satellites found.');
        setUpdating(false);
        return;
      }

      // Step 2: Tag satellites with their groups (customized sources if the
      // user defined any, otherwise the built-in Celestrak groups), downloading
      // in parallel and skipping groups that are already tagged.
      const tagResult = await fetchAndTagCategories(undefined, 4, (done, total, current) => {
        showMsg(`Tagging satellites (${done}/${total})… ${current}`);
      });

      showMsg(
        `${allResult.inserted} satellites updated, ${tagResult.tagged} category tags applied` +
          ` (${tagResult.skipped} already tagged, ${tagResult.errors} group fetch(es) failed).`,
      );
    } catch {
      showError('Update failed. Check console.');
    }
    setUpdating(false);
  };

  const handleImportFile = async (file: File) => {
    setUpdating(true);
    try {
      const text = await file.text();
      const count = await importSatelliteFile(text, file.name.replace(/\.[^.]+$/, '') || 'Custom');
      const [satCount, radioCount] = await Promise.all([db.entries.count(), db.radios.count()]);
      store.updateDatabaseState({
        numberOfSatellites: satCount,
        numberOfRadios: radioCount,
        updateTimestamp: Date.now(),
      });
      showMsg(
        count > 0
          ? `Imported ${count} satellites from ${file.name}.`
          : `No satellites parsed from ${file.name} — expected a TLE (.txt) or OMM/CSV (.csv) file.`,
      );
    } catch (err) {
      showError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setUpdating(false);
  };

  const handleFetchTransceivers = async () => {
    setUpdating(true);
    showMsg('Downloading transceiver data...');
    try {
      const radios = await fetchTransceivers();
      showMsg(`${radios.length} transceivers loaded.`);
      const [satCount, radioCount] = await Promise.all([db.entries.count(), db.radios.count()]);
      store.updateDatabaseState({
        numberOfSatellites: satCount,
        numberOfRadios: radioCount,
        updateTimestamp: Date.now(),
      });
    } catch {
      showError('Transceiver fetch failed.');
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
            <div className={styles.updateMsg}>
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
            {updating ? '⏳ Updating...' : '⬇ Update satellite data'}
          </button>
          <button
            className={styles.btn}
            onClick={handleFetchTransceivers}
            disabled={updating}
          >
            {updating ? '⏳ Loading...' : '📻 Fetch Transceivers'}
          </button>
          {updateMsg && (
            <div className={`${styles.updateMsg} ${updateMsgIsError ? styles.updateMsgError : ''}`}>{updateMsg}</div>
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
                    showMsg(null);
                    const result = await fetchAndStoreSatelliteData([url], cat);
                    if (result.errors.length > 0) {
                      showError(`${cat}: ${result.errors[0]}`);
                    } else {
                      showMsg(`${cat}: ${result.message}`);
                    }
                    setUpdating(false);
                  }}
                >
                  {cat}
                </button>
              ))}
          </div>
        </section>

        {/* Import Section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Import Orbital Data</h3>
          <p className={styles.posHint}>
            Load satellites from a local TLE (.txt) or OMM/CSV (.csv) file. Imported satellites are
            tagged "{'Custom'}" and available in the Satellites page.
          </p>
          <button
            className={styles.btn}
            onClick={() => fileInputRef.current?.click()}
            disabled={updating}
          >
            📂 Import TLE / OMM file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.tle,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />
        </section>

        {/* Data Sources Section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Satellite Data Sources</h3>
          <p className={styles.posHint}>
            Customize which groups are downloaded for category tagging. The base catalog
            (all active satellites) always comes from Celestrak's GROUP=active. Leaving the
            list empty restores the built-in Celestrak groups.
          </p>
          {sources.map((source, i) => (
            <div key={i} className={styles.sourceRow}>
              <input
                className={styles.sourceNameInput}
                value={source.name}
                placeholder="Name (category tag)"
                onChange={(e) => {
                  const next = [...sources];
                  next[i] = { ...next[i], name: e.target.value };
                  setSources(next);
                  setSourcesSaved(false);
                }}
              />
              <input
                className={styles.sourceUrlInput}
                value={source.url}
                placeholder="https://... (TLE or CSV URL)"
                onChange={(e) => {
                  const next = [...sources];
                  next[i] = { ...next[i], url: e.target.value };
                  setSources(next);
                  setSourcesSaved(false);
                }}
              />
              <button
                className={buttons.actionBtn}
                onClick={() => {
                  setSources((prev) => prev.filter((_, j) => j !== i));
                  setSourcesSaved(false);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className={styles.sourceRow}>
            <button
              className={buttons.actionBtn}
              onClick={() => {
                setSources((prev) => [...prev, { name: '', url: '' }]);
                setSourcesSaved(false);
              }}
            >
              + Add source
            </button>
            <button
              className={`${buttons.actionBtn} ${buttons.primary}`}
              onClick={() => {
                const valid = sources.filter((s) => s.name.trim() && s.url.trim());
                store.updateDataSourcesSettings({
                  ...store.dataSourcesSettings,
                  satelliteSources: valid,
                });
                setSourcesSaved(true);
              }}
            >
              Save sources
            </button>
            {sourcesSaved && (
              <span className={styles.savedMsg}>
                Saved ✓
              </span>
            )}
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
