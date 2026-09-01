import { useEffect, useMemo } from 'react';
import { TopBar } from '../../presentation/Components';
import {
  useStatusStore,
  STATUS_ACTIVE,
  STATUS_TLM,
  STATUS_NOT_HEARD,
  STATUS_CONFLICT,
  STATUS_NO_REPORT,
  getStatusColor,
  classifyBand,
  stripBandSuffix,
  satSummary,
  satReportCount,
  heardInLast24h,
  filterAndSortStatuses,
  buildStatusCsv,
  BAND_FILTERS,
} from './statusStore';
import type { SatDay, SatReport, SatSlot, SatStatus, StatusSort } from './statusStore';
import { noradUrl } from '../../lib/noradUrl';
import styles from './StatusPage.module.css';
import buttons from '../../presentation/buttons.module.css';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const HOUR_STARTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatFetchedAt(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()} - ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** Newest report among the slot's report ids. */
function newestReport(slot: SatSlot, reports: Record<string, SatReport>): SatReport | undefined {
  let newest: SatReport | undefined;
  for (const id of slot.reportIds) {
    const r = reports[id];
    if (!r) continue;
    if (!newest || r.timeMs > newest.timeMs) newest = r;
  }
  return newest;
}

function slotTitle(slot: SatSlot, reports: Record<string, SatReport>): string {
  if (slot.count === 0) return 'No reports';
  const newest = newestReport(slot, reports);
  return newest ? `${slot.count} report(s) — ${newest.statusText}` : 'No reports';
}

/** Opacity for a slot based on the newest report's recency band. */
function slotOpacity(period: number): number {
  if (period <= 1) return 1;
  if (period === 2) return 0.65;
  if (period === 3) return 0.45;
  return 1;
}

function downloadCsv(csv: string, filename = 'amsat-status.csv'): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className={styles.legendItem}>
      <span className={styles.swatch} style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function DayRow({
  day,
  reports,
  satName,
  onSelect,
}: {
  day: SatDay;
  reports: Record<string, SatReport>;
  satName: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div className={styles.dayRow}>
      <span className={styles.dayLabel}>{day.dateLabel}</span>
      <div className={styles.slots}>
        {day.slots.map((slot, i) => (
          <div
            key={i}
            className={styles.slot}
            style={{ background: slot.color, opacity: slotOpacity(slot.period) }}
            title={slotTitle(slot, reports)}
            onClick={() => onSelect(satName)}
          />
        ))}
      </div>
    </div>
  );
}

function SatSection({
  status,
  reports,
  catalog,
  tracked,
  selected,
  onToggle,
}: {
  status: SatStatus;
  reports: Record<string, SatReport>;
  catalog: ReturnType<typeof useStatusStore.getState>['catalog'];
  tracked: Map<string, number>;
  selected: boolean;
  onToggle: (name: string) => void;
}) {
  const entry = catalog.find((c) => c.name === status.name);
  const band = classifyBand(status.name);
  const summary = satSummary(status, reports);
  const total = satReportCount(status);
  const heard24 = heardInLast24h(status, reports, Date.now());
  const baseName = stripBandSuffix(status.name);
  const catnum = tracked.get(baseName.toLowerCase());

  // Newest report overall (for "last" display and the details panel).
  const allReports = useMemo(() => {
    const list: SatReport[] = [];
    for (const day of status.days) {
      for (const slot of day.slots) {
        for (const id of slot.reportIds) {
          const r = reports[id];
          if (r) list.push(r);
        }
      }
    }
    return list.sort((a, b) => b.timeMs - a.timeMs);
  }, [status, reports]);

  const lastTime = allReports[0]?.timeUtc;

  const summaryBits: string[] = [];
  if (summary.heard > 0) summaryBits.push(`${summary.heard} heard`);
  if (summary.telemetry > 0) summaryBits.push(`${summary.telemetry} tlm`);
  if (summary.notHeard > 0) summaryBits.push(`${summary.notHeard} n.h.`);
  if (summary.other > 0) summaryBits.push(`${summary.other} other`);

  return (
    <div className={`${styles.satSection} ${selected ? styles.satSectionSelected : ''}`}>
      <div className={styles.satHeader} onClick={() => onToggle(status.name)}>
        <div className={styles.satHeaderMain}>
          <span className={styles.satName}>{entry?.displayName ?? baseName}</span>
          <span className={styles.bandChip}>{band}</span>
          {catnum !== undefined && (
            <>
              <span className={styles.trackedBadge} title="In your tracked satellite list">✓ tracked</span>
              <a
                href={noradUrl(catnum)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.n2yoLink}
                onClick={(e) => e.stopPropagation()}
              >
                #{catnum}
              </a>
            </>
          )}
          {entry?.website && (
            <a
              href={entry.website}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.amsatLink}
              onClick={(e) => e.stopPropagation()}
            >
              AMSAT live ↗
            </a>
          )}
        </div>
        <div className={styles.satMeta}>
          <span>{total} reports · {summaryBits.join(' · ') || 'no reports'}</span>
          {lastTime && <span>· last {lastTime}</span>}
          {heard24 > 0 && <span className={styles.heard24}>· {heard24} heard (24h)</span>}
        </div>
      </div>

      {selected && (
        <div className={styles.details}>
          <div className={styles.detailsHeader}>
            <span className={styles.detailsTitle}>Reports (72h)</span>
            <button
              className={styles.detailsClose}
              onClick={() => onToggle(status.name)}
              title="Hide details"
            >
              ▲ Hide
            </button>
          </div>
          {allReports.map((r) => (
            <div key={r.id} className={styles.detailRow}>
              <span className={styles.detailDot} style={{ background: getStatusColor(r.statusText) }} />
              <span className={styles.detailStatus}>{r.statusText}</span>
              <span className={styles.detailCall}>{r.call || '—'}</span>
              <span className={styles.detailGrid}>{r.grid || '—'}</span>
              <span className={styles.detailTime}>{r.dateUtc} {r.timeUtc}</span>
            </div>
          ))}
          {allReports.length === 0 && (
            <div className={styles.detailEmpty}>No reports in the last 72 hours.</div>
          )}
        </div>
      )}

      {status.days.map((day) => (
        <DayRow
          key={day.dateLabel}
          day={day}
          reports={reports}
          satName={status.name}
          onSelect={onToggle}
        />
      ))}
    </div>
  );
}

export function StatusPage() {
  const store = useStatusStore();
  const {
    isLoading, isRefreshing, statuses, reports, catalog,
    fetchedAtMs, error, searchQuery, sort, bands, onlyHeard24h, autoRefresh, selectedName, tracked,
  } = store;

  useEffect(() => {
    store.fetchStatus();
    store.loadTracked();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      store.refresh();
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowMs = fetchedAtMs ?? Date.now();
  const filtered = useMemo(
    () => filterAndSortStatuses(statuses, catalog, reports, { query: searchQuery, sort, bands, onlyHeard24h }, nowMs),
    [statuses, catalog, reports, searchQuery, sort, bands, onlyHeard24h, nowMs],
  );
  const hasFilters = searchQuery.trim() !== '' || bands.length > 0 || onlyHeard24h;

  const handleExport = () => {
    downloadCsv(buildStatusCsv(reports));
  };

  return (
    <div className={styles.page}>
      <TopBar
        title="AMSAT Status"
        actions={
          <>
            <button
              className={`${buttons.actionBtn} ${autoRefresh ? buttons.actionBtnActive : ''}`}
              onClick={() => store.setAutoRefresh(!autoRefresh)}
              title="Auto-refresh every 10 minutes"
            >
              Auto
            </button>
            <button
              className={buttons.actionBtn}
              onClick={handleExport}
              disabled={Object.keys(reports).length === 0}
              title="Export reports to CSV"
            >
              ⬇
            </button>
            <button className={buttons.actionBtn} onClick={store.refresh} disabled={isRefreshing}>
              ↻
            </button>
          </>
        }
      />

      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search satellites…"
          value={searchQuery}
          onChange={(e) => store.setSearchQuery(e.target.value)}
        />
        <select
          className={buttons.actionSelect}
          value={sort}
          onChange={(e) => store.setSort(e.target.value as StatusSort)}
          title="Sort order"
        >
          <option value="name">Sort: name</option>
          <option value="activity">Sort: activity</option>
        </select>
        <label className={styles.heardToggle}>
          <input
            type="checkbox"
            checked={onlyHeard24h}
            onChange={(e) => store.setOnlyHeard24h(e.target.checked)}
          />
          Heard 24h
        </label>
        {hasFilters && (
          <button className={buttons.actionBtn} onClick={store.clearFilters} title="Clear filters">
            ✕
          </button>
        )}
      </div>

      <div className={styles.bandRow}>
        {BAND_FILTERS.map((band) => (
          <button
            key={band}
            className={`${styles.bandChipBtn} ${bands.includes(band) ? styles.bandChipActive : ''}`}
            onClick={() => store.toggleBand(band)}
          >
            {band}
          </button>
        ))}
      </div>

      {fetchedAtMs !== null && (
        <div className={styles.updated}>
          Updated {formatFetchedAt(fetchedAtMs)} UTC · {statuses.length} satellites
        </div>
      )}

      <div className={styles.legend}>
        <LegendItem color={STATUS_ACTIVE} label="Heard" />
        <LegendItem color={STATUS_TLM} label="Telemetry" />
        <LegendItem color={STATUS_NOT_HEARD} label="Not heard" />
        <LegendItem color={STATUS_CONFLICT} label="Conflict" />
        <LegendItem color={STATUS_NO_REPORT} label="No report" />
      </div>

      {isLoading ? (
        <div className={styles.loading}>Loading AMSAT status…</div>
      ) : error ? (
        <div className={styles.error}>
          <span>{error}</span>
          <button className={buttons.actionBtn} onClick={store.fetchStatus}>
            Retry
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {/* Time axis — aligned with the slot columns below */}
          <div className={styles.dayRow}>
            <span className={styles.dayLabel} />
            <div className={styles.slots}>
              {HOUR_STARTS.map((h) => (
                <div
                  key={h}
                  className={styles.timeLabel}
                  title={`${pad2(h)}–${pad2(h + 2)} UTC`}
                >
                  {pad2(h)}
                </div>
              ))}
            </div>
          </div>

          {filtered.map((status) => (
            <SatSection
              key={status.name}
              status={status}
              reports={reports}
              catalog={catalog}
              tracked={tracked}
              selected={selectedName === status.name}
              onToggle={(name) => store.selectSatellite(selectedName === name ? null : name)}
            />
          ))}

          {statuses.length === 0 && (
            <div className={styles.loading}>No AMSAT status data available.</div>
          )}
          {statuses.length > 0 && filtered.length === 0 && (
            <div className={styles.loading}>
              No satellites match the current filters.
              <button className={buttons.actionBtn} onClick={store.clearFilters} style={{ marginTop: 8 }}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
