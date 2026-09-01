import { describe, it, expect } from 'vitest';
import { buildPassesIcs, toIcsUtc, escapeIcsText } from './ics';

describe('toIcsUtc', () => {
  it('formats epoch ms as UTC YYYYMMDDTHHMMSSZ', () => {
    const ms = Date.UTC(2026, 7, 31, 1, 2, 3); // Aug 31 2026
    expect(toIcsUtc(ms)).toBe('20260831T010203Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes commas, semicolons, backslashes and newlines', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
});

describe('buildPassesIcs', () => {
  const passes = [
    { name: 'ISS (ZARYA)', catNum: 25544, aosTime: Date.UTC(2026, 8, 1, 6, 0, 0), losTime: Date.UTC(2026, 8, 1, 6, 12, 0), maxElevation: 42 },
  ];

  it('produces a valid VCALENDAR with a VEVENT per pass', () => {
    const ics = buildPassesIcs(passes);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20260901T060000Z');
    expect(ics).toContain('DTEND:20260901T061200Z');
    expect(ics).toContain('SUMMARY:Satellite pass: ISS (ZARYA)');
    expect(ics).toContain('UID:look4sat-25544-');
    expect(ics).toContain('max elev 42');
  });

  it('handles an empty pass list', () => {
    const ics = buildPassesIcs([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
