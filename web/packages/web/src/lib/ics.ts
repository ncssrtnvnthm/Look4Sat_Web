// ── iCalendar (.ics) export for satellite passes ──

export interface IcsPass {
  name: string;
  catNum: number;
  aosTime: number;
  losTime: number;
  maxElevation?: number;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Format an epoch-ms timestamp as a UTC iCalendar date-time (YYYYMMDDTHHMMSSZ). */
export function toIcsUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape text per RFC 5545 (comma, semicolon, backslash, newline). */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Build a VCALENDAR string from a list of passes. */
export function buildPassesIcs(passes: IcsPass[], title = 'Look4Sat Passes'): string {
  const now = toIcsUtc(Date.now());
  const events = passes
    .map((p) => {
      const summary = `Satellite pass: ${escapeIcsText(p.name)}`;
      const desc = `AOS ${p.aosTime} / LOS ${p.losTime} UTC` +
        (p.maxElevation != null ? ` · max elev ${p.maxElevation.toFixed(0)}°` : '') +
        ` · NORAD ${p.catNum} · via Look4Sat`;
      return [
        'BEGIN:VEVENT',
        `UID:look4sat-${p.catNum}-${p.aosTime}@look4sat`,
        `DTSTAMP:${now}`,
        `DTSTART:${toIcsUtc(p.aosTime)}`,
        `DTEND:${toIcsUtc(p.losTime)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${escapeIcsText(desc)}`,
        'END:VEVENT',
      ].join('\r\n');
    })
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Look4Sat Web//Passes//EN',
    `X-WR-CALNAME:${escapeIcsText(title)}`,
    events,
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Trigger a browser download of the generated .ics file. */
export function downloadIcs(ics: string, filename = 'look4sat-passes.ics'): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
