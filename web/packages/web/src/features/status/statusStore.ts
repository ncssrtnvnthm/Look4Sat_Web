import { create } from 'zustand';

// ── AMSAT official status colors (from amsat.org/status) ──

export const STATUS_ACTIVE = '#648FFF';
export const STATUS_TLM = '#FFB000';
export const STATUS_NOT_HEARD = '#DC267F';
export const STATUS_CONFLICT = '#FE6100';
export const STATUS_NO_REPORT = '#C0C0C0';

// ── Domain types ──

export interface SatReport {
  id: string;
  statusText: string;
  call: string;
  grid: string;
  dateUtc: string;
  timeUtc: string;
}

export interface SatSlot {
  color: string;
  count: number;
  reportIds: string[];
}

export interface SatDay {
  dateLabel: string;
  slots: SatSlot[];
}

export interface SatStatus {
  name: string;
  days: SatDay[];
}

/** Map AMSAT status text to its color (ported from the Android AmSatRepository). */
export function getStatusColor(reportText: string): string {
  switch (reportText.toLowerCase()) {
    case 'heard':
    case 'crew active':
      return STATUS_ACTIVE;
    case 'telemetry only':
      return STATUS_TLM;
    case 'not heard':
      return STATUS_NOT_HEARD;
    default:
      return STATUS_CONFLICT;
  }
}

// ── Store ──

interface StatusState {
  isLoading: boolean;
  isRefreshing: boolean;
  statuses: SatStatus[];
  reports: Record<string, SatReport>;
  fetchedAtMs: number | null;
  error: string | null;

  fetchStatus: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CATALOG_URL = 'https://www.amsat.org/status/api/v1/catalog.php';
const REPORTS_URL = 'https://www.amsat.org/status/api/v1/reports.php?hours=72&limit=500';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface ApiReport {
  id: string;
  name: string;
  callsign: string;
  report: string;
  gridSquare: string;
  timeMs: number;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function parseCatalog(json: unknown): string[] {
  try {
    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data
      .map((o) => (o as { name?: unknown }).name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    return [];
  }
}

function parseReports(json: unknown): ApiReport[] {
  try {
    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    const out: ApiReport[] = [];
    for (const o of data) {
      const obj = o as Record<string, unknown>;
      const iso = typeof obj.reported_time === 'string' ? obj.reported_time : '';
      if (!iso) continue;
      const timeMs = Date.parse(iso);
      if (Number.isNaN(timeMs)) continue;
      out.push({
        id: typeof obj.id === 'string' ? obj.id : '',
        name: typeof obj.name === 'string' ? obj.name : '',
        callsign: typeof obj.callsign === 'string' ? obj.callsign : '',
        report: typeof obj.report === 'string' ? obj.report : '',
        gridSquare: typeof obj.grid_square === 'string' ? obj.grid_square : '',
        timeMs,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Build one SatStatus (3 days x 12 slots) per catalog satellite, slotting reports by age. */
function buildStatuses(names: string[], reports: ApiReport[], nowMs: number): SatStatus[] {
  const nowSec = Math.floor(nowMs / 1000);
  const byName = new Map<string, ApiReport[]>();
  for (const r of reports) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }

  // Day labels, newest first (d=0 is the most recent day).
  const labels: string[] = [];
  for (let d = 0; d < 3; d++) {
    const t = new Date((nowSec - d * 86400) * 1000);
    labels.push(`${MONTH_ABBR[t.getUTCMonth()]} ${t.getUTCDate()}`);
  }

  return names.map((name) => {
    // 36 slots of 2 hours each ending at nowSec; i=0 is the most recent slot.
    const slots: SatSlot[] = [];
    for (let i = 0; i < 36; i++) {
      const slotStartMs = (nowSec - (i + 1) * 7200) * 1000;
      const slotEndMs = (nowSec - i * 7200) * 1000;
      const inSlot = (byName.get(name) ?? []).filter(
        (r) => r.timeMs >= slotStartMs && r.timeMs < slotEndMs,
      );
      if (inSlot.length === 0) {
        slots.push({ color: STATUS_NO_REPORT, count: 0, reportIds: [] });
      } else {
        let newest = inSlot[0];
        for (const r of inSlot) {
          if (r.timeMs > newest.timeMs) newest = r;
        }
        slots.push({
          color: getStatusColor(newest.report),
          count: inSlot.length,
          reportIds: inSlot.map((r) => r.id),
        });
      }
    }

    const days: SatDay[] = [];
    for (let d = 0; d < 3; d++) {
      days.push({ dateLabel: labels[d], slots: slots.slice(d * 12, (d + 1) * 12) });
    }
    return { name, days };
  });
}

function toSatReport(r: ApiReport): SatReport {
  const d = new Date(r.timeMs);
  return {
    id: r.id,
    statusText: r.report,
    call: r.callsign,
    grid: r.gridSquare,
    dateUtc: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    timeUtc: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`,
  };
}

export const useStatusStore = create<StatusState>()((set, get) => ({
  isLoading: false,
  isRefreshing: false,
  statuses: [],
  reports: {},
  fetchedAtMs: null,
  error: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const [catalogJson, reportsJson] = await Promise.all([
        fetchJson(CATALOG_URL),
        fetchJson(REPORTS_URL),
      ]);
      const names = parseCatalog(catalogJson);
      const apiReports = parseReports(reportsJson);

      if (names.length === 0 && apiReports.length === 0) {
        set({
          isLoading: false,
          isRefreshing: false,
          error: 'Could not load AMSAT status data. Please try again.',
        });
        return;
      }

      const statuses = buildStatuses(names, apiReports, Date.now());
      const reports: Record<string, SatReport> = {};
      for (const r of apiReports) {
        if (r.id) reports[r.id] = toSatReport(r);
      }

      set({
        isLoading: false,
        isRefreshing: false,
        statuses,
        reports,
        fetchedAtMs: Date.now(),
        error: null,
      });
    } catch (err) {
      console.error('Failed to fetch AMSAT status:', err);
      set({
        isLoading: false,
        isRefreshing: false,
        error: 'Failed to load AMSAT status. Check your connection and try again.',
      });
    }
  },

  refresh: async () => {
    if (get().isRefreshing) return;
    set({ isRefreshing: true, error: null });
    await get().fetchStatus();
  },
}));
