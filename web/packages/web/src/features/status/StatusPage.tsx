import { useEffect } from 'react';
import { TopBar } from '../../presentation/Components';
import {
  useStatusStore,
  STATUS_ACTIVE,
  STATUS_TLM,
  STATUS_NOT_HEARD,
  STATUS_CONFLICT,
  STATUS_NO_REPORT,
} from './statusStore';
import type { SatDay, SatReport, SatSlot, SatStatus } from './statusStore';
import styles from './StatusPage.module.css';
import buttons from '../../presentation/buttons.module.css';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatFetchedAt(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = MONTH_ABBR[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${day} ${month} ${year} - ${hh}:${mm}:${ss}`;
}

/** Newest report among the slot's report ids (UTC date/time strings sort chronologically). */
function newestReport(
  slot: SatSlot,
  reports: Record<string, SatReport>,
): SatReport | undefined {
  let newest: SatReport | undefined;
  for (const id of slot.reportIds) {
    const r = reports[id];
    if (!r) continue;
    if (!newest || `${r.dateUtc} ${r.timeUtc}` > `${newest.dateUtc} ${newest.timeUtc}`) {
      newest = r;
    }
  }
  return newest;
}

function slotTitle(slot: SatSlot, reports: Record<string, SatReport>): string {
  if (slot.count === 0) return 'No reports';
  const newest = newestReport(slot, reports);
  return newest ? `${slot.count} report(s) — ${newest.statusText}` : 'No reports';
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className={styles.legendItem}>
      <span className={styles.swatch} style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function DayRow({ day, reports }: { day: SatDay; reports: Record<string, SatReport> }) {
  return (
    <div className={styles.dayRow}>
      <span className={styles.dayLabel}>{day.dateLabel}</span>
      <div className={styles.slots}>
        {day.slots.map((slot, i) => (
          <div
            key={i}
            className={styles.slot}
            style={{ background: slot.color }}
            title={slotTitle(slot, reports)}
          />
        ))}
      </div>
    </div>
  );
}

function SatSection({ status, reports }: { status: SatStatus; reports: Record<string, SatReport> }) {
  return (
    <div className={styles.satSection}>
      <div className={styles.satName}>{status.name}</div>
      {status.days.map((day) => (
        <DayRow key={day.dateLabel} day={day} reports={reports} />
      ))}
    </div>
  );
}

export function StatusPage() {
  const store = useStatusStore();
  const { isLoading, isRefreshing, statuses, reports, fetchedAtMs, error } = store;

  useEffect(() => {
    store.fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>
      <TopBar
        title="AMSAT Status"
        actions={
          <button className={buttons.actionBtn} onClick={store.refresh} disabled={isRefreshing}>
            ↻ Refresh
          </button>
        }
      />

      {fetchedAtMs !== null && (
        <div className={styles.updated}>Updated {formatFetchedAt(fetchedAtMs)} UTC</div>
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
          {statuses.map((status) => (
            <SatSection key={status.name} status={status} reports={reports} />
          ))}
          {statuses.length === 0 && (
            <div className={styles.loading}>No AMSAT status data available.</div>
          )}
        </div>
      )}
    </div>
  );
}
