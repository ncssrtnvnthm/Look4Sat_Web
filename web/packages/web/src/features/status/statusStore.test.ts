import { describe, it, expect } from 'vitest';
import {
  parseReports,
  buildStatuses,
  classifyBand,
  stripBandSuffix,
  satSummary,
  satReportCount,
  heardInLast24h,
  filterAndSortStatuses,
  buildStatusCsv,
} from './statusStore';
import type { SatReport, SatStatus } from './statusStore';

function report(id: string, status: string, timeMs: number): SatReport {
  const d = new Date(timeMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id,
    statusText: status,
    call: `CALL${id}`,
    grid: 'JN48',
    dateUtc: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    timeUtc: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`,
    timeMs,
    period: 1,
  };
}

function makeStatus(name: string, slots: Array<{ count: number; status: string; timeMs: number }>): SatStatus {
  // Build 1 day x 12 slots; fill only the provided slots.
  const days = [
    {
      dateLabel: 'Sep 1',
      slots: slots.map((s, i) => ({
        color: '#000',
        count: s.count,
        reportIds: s.count > 0 ? [`${name}-${i}`] : [],
        period: s.count > 0 ? 1 : -1,
      })),
    },
  ];
  return { name, days };
}

const now = Date.UTC(2026, 8, 1, 12, 0, 0); // Sep 1 12:00 UTC

describe('classifyBand', () => {
  it('maps bracket suffixes to families', () => {
    expect(classifyBand('AO-123_[FM]')).toBe('FM');
    expect(classifyBand('AO-7_[U/v]')).toBe('Linear');
    expect(classifyBand('FO-29_[V/u]')).toBe('Linear');
    expect(classifyBand('AO-91_[SSTV]')).toBe('SSTV');
    expect(classifyBand('LASARsat_[UHF_Digi]')).toBe('Digi');
    expect(classifyBand('NO-84')).toBe('Other');
  });
});

describe('stripBandSuffix', () => {
  it('strips the bracketed suffix', () => {
    expect(stripBandSuffix('FO-29_[V/u]')).toBe('FO-29');
    expect(stripBandSuffix('AO-123_[FM]')).toBe('AO-123');
    expect(stripBandSuffix('NO-84')).toBe('NO-84');
  });
});

describe('summaries', () => {
  const status = makeStatus('FO-29_[V/u]', [
    { count: 1, status: 'Heard', timeMs: now - 3600_000 },
    { count: 1, status: 'Telemetry Only', timeMs: now - 2 * 3600_000 },
    { count: 1, status: 'Not Heard', timeMs: now - 30 * 3600_000 },
    { count: 0, status: '', timeMs: 0 },
  ]);
  const reports: Record<string, SatReport> = {
    'FO-29_[V/u]-0': report('FO-29_[V/u]-0', 'Heard', now - 3600_000),
    'FO-29_[V/u]-1': report('FO-29_[V/u]-1', 'Telemetry Only', now - 2 * 3600_000),
    'FO-29_[V/u]-2': report('FO-29_[V/u]-2', 'Not Heard', now - 30 * 3600_000),
  };

  it('counts reports and summarizes by status', () => {
    expect(satReportCount(status)).toBe(3);
    const s = satSummary(status, reports);
    expect(s.heard).toBe(1);
    expect(s.telemetry).toBe(1);
    expect(s.notHeard).toBe(1);
    expect(s.other).toBe(0);
  });

  it('counts heard reports within the last 24h only', () => {
    // Only the "Heard" report is within 24h; "Telemetry Only" is < 24h but not "heard".
    expect(heardInLast24h(status, reports, now)).toBe(1);
  });
});

describe('filterAndSortStatuses', () => {
  const statuses = [
    makeStatus('AO-7_[U/v]', [{ count: 1, status: 'Heard', timeMs: now - 1000 }]),
    makeStatus('FO-29_[V/u]', [{ count: 3, status: 'Heard', timeMs: now - 1000 }]),
    makeStatus('AO-91_[SSTV]', [{ count: 0, status: '', timeMs: 0 }]),
  ];
  const reports: Record<string, SatReport> = {
    'AO-7_[U/v]-0': report('AO-7_[U/v]-0', 'Heard', now - 1000),
    'FO-29_[V/u]-0': report('FO-29_[V/u]-0', 'Heard', now - 1000),
  };
  const catalog = [
    { id: 2, name: 'AO-7_[U/v]', displayName: 'AO-7 [U/v]', website: '' },
    { id: 3, name: 'FO-29_[V/u]', displayName: 'FO-29 [V/u]', website: '' },
    { id: 4, name: 'AO-91_[SSTV]', displayName: 'AO-91 [SSTV]', website: '' },
  ];

  it('sorts by name by default', () => {
    const out = filterAndSortStatuses(statuses, catalog, reports, { query: '', sort: 'name', bands: [], onlyHeard24h: false }, now);
    expect(out.map((s) => s.name)).toEqual(['AO-7_[U/v]', 'AO-91_[SSTV]', 'FO-29_[V/u]']);
  });

  it('sorts by activity (report count desc)', () => {
    const out = filterAndSortStatuses(statuses, catalog, reports, { query: '', sort: 'activity', bands: [], onlyHeard24h: false }, now);
    expect(out[0].name).toBe('FO-29_[V/u]');
  });

  it('filters by search query (display name included)', () => {
    const out = filterAndSortStatuses(statuses, catalog, reports, { query: 'ao-7', sort: 'name', bands: [], onlyHeard24h: false }, now);
    expect(out.map((s) => s.name)).toEqual(['AO-7_[U/v]']);
  });

  it('filters by band', () => {
    const out = filterAndSortStatuses(statuses, catalog, reports, { query: '', sort: 'name', bands: ['SSTV'], onlyHeard24h: false }, now);
    expect(out.map((s) => s.name)).toEqual(['AO-91_[SSTV]']);
  });

  it('filters to satellites heard in the last 24h', () => {
    const out = filterAndSortStatuses(statuses, catalog, reports, { query: '', sort: 'name', bands: [], onlyHeard24h: true }, now);
    expect(out.map((s) => s.name).sort()).toEqual(['AO-7_[U/v]', 'FO-29_[V/u]']);
  });
});

describe('buildStatusCsv', () => {
  it('emits a header plus one row per report', () => {
    const reports: Record<string, SatReport> = {
      r1: report('r1', 'Heard', Date.UTC(2026, 8, 1, 10, 0, 0)),
      r2: report('r2', 'Telemetry Only', Date.UTC(2026, 8, 1, 11, 0, 0)),
    };
    const csv = buildStatusCsv(reports);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('satellite,status,callsign,grid,date_utc,time_utc');
    expect(lines).toHaveLength(3);
    expect(csv).toContain('Heard');
    expect(csv).toContain('CALLr1');
  });

  it('quotes fields containing commas', () => {
    const reports: Record<string, SatReport> = {
      r1: { ...report('r1', 'Heard', Date.UTC(2026, 8, 1, 10, 0, 0)), call: 'A,B' },
    };
    const csv = buildStatusCsv(reports);
    expect(csv).toContain('"A,B"');
  });
});

describe('numeric report ids (AMSAT returns numbers)', () => {
  it('parseReports converts numeric ids to strings', () => {
    const json = {
      data: [
        { id: 1352624, name: 'FO-29_[V/u]', reported_time: '2026-09-01T17:30:00Z', callsign: 'ZL3AHW/M', report: 'Heard', grid_square: 'RE56uc' },
      ],
    };
    const parsed = parseReports(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('1352624');
  });

  it('slot reportIds resolve in the reports map (regression: empty ids broke details)', () => {
    const json = {
      data: [
        { id: 1352624, name: 'FO-29_[V/u]', reported_time: '2026-09-01T17:30:00Z', callsign: 'ZL3AHW/M', report: 'Heard', grid_square: 'RE56uc' },
        { id: 1352623, name: 'FO-29_[V/u]', reported_time: '2026-09-01T16:30:00Z', callsign: 'EA5JHM', report: 'Telemetry Only', grid_square: 'IM99sl' },
      ],
    };
    const apiReports = parseReports(json);
    const statuses = buildStatuses(['FO-29_[V/u]'], apiReports, Date.parse('2026-09-01T18:00:00Z'));
    const reports: Record<string, SatReport> = {};
    for (const r of apiReports) {
      reports[r.id] = report(r.id, r.report, r.timeMs);
    }
    const slots = statuses[0].days[0].slots;
    const newestSlot = slots.find((s) => s.count > 0);
    expect(newestSlot).toBeDefined();
    expect(newestSlot!.count).toBe(2);
    // Every reportId in the slot must resolve to an entry in the reports map.
    expect(newestSlot!.reportIds.every((id) => reports[id] !== undefined)).toBe(true);
  });
});
