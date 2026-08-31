// ── Shared time formatting helpers ──

/** Format a millisecond duration as HH:MM:SS (negative values use absolute value). */
export function formatTimer(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Format a timestamp as HH:MM:SS, in UTC or local time. */
export function formatPassTime(ms: number, isUtc: boolean): string {
  const date = new Date(ms);
  return isUtc
    ? date.toISOString().substring(11, 19)
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Format a timestamp as a short date (weekday + month + day), in UTC or local time. */
export function formatDate(ms: number, isUtc: boolean): string {
  const date = new Date(ms);
  if (isUtc) {
    // Build from UTC parts so the group header matches the UTC times shown in the list.
    const weekday = date.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
    const month = date.toLocaleDateString([], { month: 'short', timeZone: 'UTC' });
    return `${weekday} ${month} ${date.getUTCDate()}`;
  }
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Group passes by their AOS date (UTC or local, matching the times displayed). */
export function groupPassesByDate<T extends { aosTime: number }>(
  passes: T[],
  isUtc: boolean,
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const pass of passes) {
    const key = formatDate(pass.aosTime, isUtc);
    if (!groups[key]) groups[key] = [];
    groups[key].push(pass);
  }
  return groups;
}
