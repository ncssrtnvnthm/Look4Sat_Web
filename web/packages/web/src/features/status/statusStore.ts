import { create } from 'zustand';
import { useSelectedStore } from '../../data/stores';
import { getEntriesWithIds } from '../../data/database';

// ── AMSAT official status colors (from amsat.org/status) ──

export const STATUS_ACTIVE = '#648FFF';
export const STATUS_TLM = '#FFB000';
export const STATUS_NOT_HEARD = '#DC267F';
export const STATUS_CONFLICT = '#FE6100';
export const STATUS_NO_REPORT = '#C0C0C0';

// ── Domain types ──

export interface CatalogEntry {
  id: number;
  name: string;
  displayName: string;
  website: string;
}

export interface SatReport {
  id: string;
  statusText: string;
  call: string;
  grid: string;
  dateUtc: string;
  timeUtc: string;
  timeMs: number;
  /** AMSAT recency band (0 = freshest … 3 = oldest). */
  period: number;
}

export interface SatSlot {
  color: string;
  count: number;
  reportIds: string[];
  /** Recency band of the newest report in the slot (-1 = no reports). */
  period: number;
}

export interface SatDay {
  dateLabel: string;
  slots: SatSlot[];
}

export interface SatStatus {
  name: string;
  days: SatDay[];
}

export type StatusSort = 'name' | 'activity';

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

/** Strip the mode/band bracket: "FO-29_[V/u]" → "FO-29". */
export function stripBandSuffix(name: string): string {
  return name.replace(/_[^_]*$/, '').trim();
}

/** Classify the mode/band bracket into a small set of filter families. */
export function classifyBand(name: string): string {
  const bracket = name.match(/\[([^\]]+)\]/)?.[1]?.toLowerCase() ?? '';
  if (bracket === 'fm') return 'FM';
  if (bracket === 'sstv') return 'SSTV';
  if (bracket.includes('digi')) return 'Digi';
  if (bracket.includes('/')) return 'Linear';
  return 'Other';
}

export const BAND_FILTERS = ['FM', 'Linear', 'SSTV', 'Digi', 'Other'] as const;

/** Total reports (72h) for a satellite (counts live in the slots). */
export function satReportCount(status: SatStatus): number {
  let count = 0;
  for (const day of status.days) {
    for (const slot of day.slots) count += slot.count;
  }
  return count;
}

/** Heard / Crew-active report count within the last 24h. */
export function heardInLast24h(status: SatStatus, reports: Record<string, SatReport>, nowMs: number): number {
  const cutoff = nowMs - 24 * 3600 * 1000;
  let count = 0;
  for (const day of status.days) {
    for (const slot of day.slots) {
      for (const id of slot.reportIds) {
        const r = reports[id];
        if (!r || r.timeMs < cutoff) continue;
        const t = r.statusText.toLowerCase();
        if (t === 'heard' || t === 'crew active') count++;
      }
    }
  }
  return count;
}

/** Per-status counts (heard / telemetry / not-heard / other) over the window. */
export function satSummary(
  status: SatStatus,
  reports: Record<string, SatReport>,
): { heard: number; telemetry: number; notHeard: number; other: number } {
  const summary = { heard: 0, telemetry: 0, notHeard: 0, other: 0 };
  for (const day of status.days) {
    for (const slot of day.slots) {
      for (const id of slot.reportIds) {
        const r = reports[id];
        if (!r) continue;
        const t = r.statusText.toLowerCase();
        if (t === 'heard' || t === 'crew active') summary.heard++;
        else if (t === 'telemetry only') summary.telemetry++;
        else if (t === 'not heard') summary.notHeard++;
        else summary.other++;
      }
    }
  }
  return summary;
}

export interface StatusFilter {
  query: string;
  sort: StatusSort;
  bands: string[];
  onlyHeard24h: boolean;
}

/**
 * Filter + sort the status list (pure, testable).
 * @param nowMs reference time for the 24h filter.
 */
export function filterAndSortStatuses(
  statuses: SatStatus[],
  catalog: CatalogEntry[],
  reports: Record<string, SatReport>,
  filter: StatusFilter,
  nowMs: number,
): SatStatus[] {
  const q = filter.query.trim().toLowerCase();
  const bandSet = new Set(filter.bands);

  let list = statuses.filter((status) => {
    if (q) {
      const entry = catalog.find((c) => c.name === status.name);
      const display = entry?.displayName ?? stripBandSuffix(status.name);
      if (!status.name.toLowerCase().includes(q) && !display.toLowerCase().includes(q)) return false;
    }
    if (bandSet.size > 0 && !bandSet.has(classifyBand(status.name))) return false;
    if (filter.onlyHeard24h && heardInLast24h(status, reports, nowMs) === 0) return false;
    return true;
  });

  list = [...list].sort((a, b) => {
    if (filter.sort === 'activity') {
      const diff = satReportCount(b) - satReportCount(a);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  return list;
}

/** Serialize all reports to CSV (RFC 4180-ish; fields quoted when needed). */
export function buildStatusCsv(reports: Record<string, SatReport>): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [
    ['satellite', 'status', 'callsign', 'grid', 'date_utc', 'time_utc'],
  ];
  for (const r of Object.values(reports)) {
    rows.push([r.id, r.statusText, esc(r.call), esc(r.grid), r.dateUtc, r.timeUtc]);
  }
  return rows.map((row) => row.join(',')).join('\n');
}

// ── Store ──

interface StatusState {
  isLoading: boolean;
  isRefreshing: boolean;
  statuses: SatStatus[];
  reports: Record<string, SatReport>;
  catalog: CatalogEntry[];
  fetchedAtMs: number | null;
  error: string | null;

  // Filters / UI state
  searchQuery: string;
  sort: StatusSort;
  bands: string[];
  onlyHeard24h: boolean;
  autoRefresh: boolean;
  selectedName: string | null;
  /** Satellites in the user's tracked list: base name → catnum. */
  tracked: Map<string, number>;

  fetchStatus: () => Promise<void>;
  refresh: () => Promise<void>;
  loadTracked: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSort: (s: StatusSort) => void;
  toggleBand: (band: string) => void;
  setOnlyHeard24h: (v: boolean) => void;
  setAutoRefresh: (v: boolean) => void;
  selectSatellite: (name: string | null) => void;
  clearFilters: () => void;
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
  period: number;
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

function parseCatalog(json: unknown): CatalogEntry[] {
  try {
    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    const out: CatalogEntry[] = [];
    for (const o of data) {
      const obj = o as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name : '';
      if (!name) continue;
      out.push({
        id: typeof obj.id === 'number' ? obj.id : 0,
        name,
        displayName: typeof obj.display_name === 'string' && obj.display_name ? obj.display_name : name,
        website: typeof obj.website === 'string' ? obj.website : '',
      });
    }
    return out;
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
        period: typeof obj.period === 'number' ? obj.period : -1,
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
        slots.push({ color: STATUS_NO_REPORT, count: 0, reportIds: [], period: -1 });
      } else {
        let newest = inSlot[0];
        for (const r of inSlot) {
          if (r.timeMs > newest.timeMs) newest = r;
        }
        slots.push({
          color: getStatusColor(newest.report),
          count: inSlot.length,
          reportIds: inSlot.map((r) => r.id),
          period: newest.period,
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
    timeMs: r.timeMs,
    period: r.period,
  };
}

export const useStatusStore = create<StatusState>()((set, get) => ({
  isLoading: false,
  isRefreshing: false,
  statuses: [],
  reports: {},
  catalog: [],
  fetchedAtMs: null,
  error: null,

  searchQuery: '',
  sort: 'name',
  bands: [],
  onlyHeard24h: false,
  autoRefresh: false,
  selectedName: null,
  tracked: new Map(),

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const [catalogJson, reportsJson] = await Promise.all([
        fetchJson(CATALOG_URL),
        fetchJson(REPORTS_URL),
      ]);
      const catalog = parseCatalog(catalogJson);
      const apiReports = parseReports(reportsJson);
      const names = catalog.map((c) => c.name);

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
        catalog,
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

  loadTracked: async () => {
    try {
      const selectedIds = useSelectedStore.getState().selectedIds;
      const entries = await getEntriesWithIds(selectedIds);
      const tracked = new Map<string, number>();
      for (const e of entries) {
        tracked.set(stripBandSuffix(e.name).toLowerCase(), e.catnum);
      }
      set({ tracked });
    } catch {
      /* keep previous tracked list */
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSort: (sort) => set({ sort }),
  toggleBand: (band) =>
    set((s) => ({
      bands: s.bands.includes(band)
        ? s.bands.filter((b) => b !== band)
        : [...s.bands, band],
    })),
  setOnlyHeard24h: (v) => set({ onlyHeard24h: v }),
  setAutoRefresh: (v) => set({ autoRefresh: v }),
  selectSatellite: (name) => set({ selectedName: name }),
  clearFilters: () => set({ searchQuery: '', bands: [], onlyHeard24h: false, sort: 'name' }),
}));
