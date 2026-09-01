import { describe, it, expect } from 'vitest';
import { formatTimer, formatPassTime, formatDate, groupPassesByDate } from './time';

describe('formatTimer', () => {
  it('formats zero', () => {
    expect(formatTimer(0)).toBe('00:00:00');
  });

  it('formats durations as HH:MM:SS', () => {
    expect(formatTimer(3661_000)).toBe('01:01:01');
    expect(formatTimer(59_999)).toBe('00:00:59');
    expect(formatTimer(3600_000)).toBe('01:00:00');
    expect(formatTimer(86_400_000)).toBe('24:00:00');
  });

  it('uses the absolute value for negative durations (countdowns)', () => {
    expect(formatTimer(-65_000)).toBe('00:01:05');
  });
});

describe('formatPassTime', () => {
  it('formats UTC when isUtc is true', () => {
    const ms = Date.UTC(2026, 7, 31, 1, 2, 28);
    expect(formatPassTime(ms, true)).toBe('01:02:28');
  });

  it('formats a local time when isUtc is false', () => {
    const ms = Date.UTC(2026, 7, 31, 1, 2, 28);
    const local = formatPassTime(ms, false);
    // HH:MM:SS with 24h clock
    expect(local).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatDate', () => {
  it('groups by UTC date when isUtc is true (late-evening UTC stays on its UTC day)', () => {
    // 2026-09-01T00:30:00Z — must be labelled Sep 1 even in UTC+ zones
    expect(formatDate(Date.UTC(2026, 8, 1, 0, 30, 0), true)).toContain('Sep');
  });
});

describe('groupPassesByDate', () => {
  it('groups passes by their UTC AOS date', () => {
    const passes = [
      { aosTime: Date.UTC(2026, 8, 1, 0, 30, 0) },
      { aosTime: Date.UTC(2026, 8, 1, 12, 0, 0) },
      { aosTime: Date.UTC(2026, 8, 2, 23, 0, 0) },
    ];
    const groups = groupPassesByDate(passes, true);
    const keys = Object.keys(groups);
    expect(keys).toHaveLength(2);
    expect(groups[keys[0]]).toHaveLength(2);
    expect(groups[keys[1]]).toHaveLength(1);
  });
});
