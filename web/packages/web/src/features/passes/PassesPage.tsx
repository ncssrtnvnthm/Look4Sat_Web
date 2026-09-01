import { useEffect, useState } from 'react';
import { TopBar, TimerRow, SwipeableItem } from '../../presentation/Components';
import { usePassesStore } from './passesStore';
import { useSettingsStore, useSelectedStore } from '../../data/stores';
import { formatPassTime, groupPassesByDate } from '../../lib/time';
import { noradUrl } from '../../lib/noradUrl';
import styles from './PassesPage.module.css';
import buttons from '../../presentation/buttons.module.css';

export function PassesPage() {
  const store = usePassesStore();
  const isUtc = useSettingsStore((s) => s.otherSettings.stateOfUtc);
  const grouped = groupPassesByDate(store.itemsList, isUtc);
  const activePass = store.selectedPass ?? store.nextPass;

  // Filter dialog drafts — applied only on "Apply & Refresh".
  const [draftHours, setDraftHours] = useState(store.hours);
  const [draftElevation, setDraftElevation] = useState(store.elevation);
  const [draftDeepSpace, setDraftDeepSpace] = useState(store.showDeepSpace);

  useEffect(() => {
    if (store.isPassesDialogShown) {
      setDraftHours(store.hours);
      setDraftElevation(store.elevation);
      setDraftDeepSpace(store.showDeepSpace);
    }
  }, [store.isPassesDialogShown]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePassClick = (catNum: number) => {
    store.selectPass(catNum);
    const selectedIds = useSelectedStore.getState().selectedIds;
    const idx = selectedIds.indexOf(catNum);
    if (idx >= 0) {
      useSelectedStore.getState().setViewedSatIndex(idx);
    }
  };

  useEffect(() => {
    store.refreshPasses();
    const id = window.setInterval(() => store.tickTimers(), 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>
      <TopBar
        title="Passes"
        actions={
          <>
            <button className={buttons.actionBtn} onClick={store.togglePassesDialog}>
              Filter
            </button>
            <button className={buttons.actionBtn} onClick={store.refreshPasses}>
              ↻
            </button>
          </>
        }
      />

      {/* Next pass countdown */}
      {activePass && (
        <div className={styles.nextPass} onClick={store.selectedPass ? store.resetSelectedPass : undefined} style={store.selectedPass ? { cursor: 'pointer' } : undefined}>
          <div className={styles.nextPassName}>
            {activePass.name}
            {store.selectedPass && (
              <span className={styles.selectedBadge} title="Click to show overall next pass">
                {' '}↩
              </span>
            )}
          </div>
          <TimerRow
            time={store.nextTime}
            isAos={store.isNextTimeAos}
            label={store.isNextTimeAos ? 'Next AOS in' : 'Next LOS in'}
          />
          <div className={styles.nextPassDetails}>
            <span>Max elev: {activePass.maxElevation.toFixed(0)}°</span>
            <span>
              {formatPassTime(activePass.aosTime, isUtc)} →{' '}
              {formatPassTime(activePass.losTime, isUtc)}
            </span>
          </div>
        </div>
      )}

      {/* What's New */}
      {store.shouldSeeWhatsNew && (
        <div className={styles.warning}>
          <span>New in v4.4: improved pass calculations, OMM/CSV support.</span>
          <button className={styles.dismissBtn} onClick={store.dismissWhatsNew}>
            ✕
          </button>
        </div>
      )}

      {/* Loading with progress */}
      {store.isRefreshing && store.calcTotal > 0 && (
        <div className={styles.refreshProgressSection}>
          <div className={styles.refreshProgressBar}>
            <div
              className={styles.refreshProgressFill}
              style={{ width: `${(store.calcProgress / store.calcTotal) * 100}%` }}
            />
          </div>
          <span className={styles.progressText}>
            {store.calcProgress} / {store.calcTotal} satellites
          </span>
          <button className={styles.cancelBtn} onClick={store.cancelRefresh}>
            Cancel
          </button>
        </div>
      )}
      {store.isRefreshing && store.calcTotal === 0 && (
        <div className={styles.loading}>Loading satellite data...</div>
      )}

      {/* Pass list grouped by date */}
      <div className={styles.list}>
        {Object.entries(grouped).map(([date, passes]) => (
          <div key={date} className={styles.group}>
            <div className={styles.groupHeader}>{date}</div>
            {passes.map((pass) => (
              <SwipeableItem key={`${pass.catNum}-${pass.aosTime}`}>
                <div className={styles.passRow} onClick={() => handlePassClick(pass.catNum)} style={{ cursor: 'pointer' }}>
                  <div className={styles.passInfo}>
                    <span className={styles.passName}>
                      {pass.name}{' '}
                      <a
                        href={noradUrl(pass.catNum)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.noradLink}
                        title="View on N2YO"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{pass.catNum}
                      </a>
                    </span>
                    <span className={styles.passTimes}>
                      {formatPassTime(pass.aosTime, isUtc)} →{' '}
                      {formatPassTime(pass.losTime, isUtc)}
                    </span>
                  </div>
                  <div className={styles.passElev}>
                    {pass.maxElevation.toFixed(0)}°
                  </div>
                </div>
                {pass.progress > 0 && pass.progress < 1 && (
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${pass.progress * 100}%` }}
                    />
                  </div>
                )}
              </SwipeableItem>
            ))}
          </div>
        ))}
        {!store.isRefreshing && store.itemsList.length === 0 && (
          <div className={styles.empty}>
            No passes found. Select satellites and configure filters.
          </div>
        )}
      </div>

      {/* Filter dialog — edits are local until "Apply & Refresh" */}
      {store.isPassesDialogShown && (
        <div className={styles.dialogOverlay} onClick={store.togglePassesDialog}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Pass Filters</h3>

            <label className={styles.dialogRow}>
              <span>Include deep-space satellites</span>
              <input
                type="checkbox"
                checked={draftDeepSpace}
                onChange={(e) => setDraftDeepSpace(e.target.checked)}
              />
            </label>

            <div className={styles.dialogRow}>
              <span>Min elevation: {draftElevation}°</span>
              <input
                type="range"
                min="0"
                max="60"
                step="1"
                value={draftElevation}
                onChange={(e) => setDraftElevation(Number(e.target.value))}
              />
            </div>

            <div className={styles.dialogRow}>
              <span>Time window: {draftHours}h</span>
              <select
                value={draftHours}
                onChange={(e) => setDraftHours(Number(e.target.value))}
              >
                {[1, 2, 4, 8, 12, 24, 48, 72, 96, 120, 144, 168, 192, 216, 240].map((h) => (
                  <option key={h} value={h}>{h}h</option>
                ))}
              </select>
            </div>

            <div className={styles.dialogActions}>
              <button className={styles.dialogBtn} onClick={store.togglePassesDialog}>
                Close
              </button>
              <button
                className={`${styles.dialogBtn} ${styles.dialogBtnPrimary}`}
                onClick={() => {
                  store.filterPasses(draftHours, draftElevation, draftDeepSpace);
                  store.refreshPasses();
                  store.togglePassesDialog();
                }}
              >
                Apply &amp; Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
