import { useSettingsStore } from './stores';
import { mergeEntries, insertRadios, db } from './database';
import type { OrbitalData, SatRadio } from '../domain/types';

// ── Celestrak data source URLs (matching Android Sources.kt) ──

export const SATELLITE_DATA_URLS: Record<string, string> = {
  All: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv',
  Amateur: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=csv',
  Amsat: 'https://amsat.org/tle/current/nasabare.txt',
  Brightest: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=csv',
  Classified: 'https://www.mmccants.org/tles/classfd.zip',
  Cubesat: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=csv',
  Education: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=education&FORMAT=csv',
  Engineer: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=engineering&FORMAT=csv',
  Geostationary: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=csv',
  Globalstar: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=globalstar&FORMAT=csv',
  GNSS: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=csv',
  Intelsat: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=intelsat&FORMAT=csv',
  Iridium: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=csv',
  McCants: 'https://www.mmccants.org/tles/inttles.zip',
  Military: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=csv',
  New: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=csv',
  OneWeb: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=csv',
  Orbcomm: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=orbcomm&FORMAT=csv',
  R4UAB: 'https://r4uab.ru/satonline.txt',
  Resource: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=csv',
  SatNOGS: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=satnogs&FORMAT=csv',
  Science: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=csv',
  Spire: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=spire&FORMAT=csv',
  Starlink: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=csv',
  Swarm: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=swarm&FORMAT=csv',
  Weather: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=csv',
  'X-Comm': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=x-comm&FORMAT=csv',
  Other: '', // filter-only key — no URL
};

// ── Human-readable category display names ──

export const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  All: 'All Satellites',
  Amateur: 'Amateur Radio',
  Amsat: 'AMSAT',
  Brightest: 'Brightest',
  Classified: 'Classified',
  Cubesat: 'CubeSats',
  Education: 'Education',
  Engineer: 'Engineering',
  Geostationary: 'Geostationary',
  Globalstar: 'Globalstar',
  GNSS: 'Navigation (GNSS)',
  Intelsat: 'Intelsat',
  Iridium: 'Iridium',
  McCants: 'McCants',
  Military: 'Military',
  New: 'Recently Launched',
  OneWeb: 'OneWeb',
  Orbcomm: 'Orbcomm',
  R4UAB: 'R4UAB',
  Resource: 'Earth Resources',
  SatNOGS: 'SatNOGS',
  Science: 'Science',
  Spire: 'Spire',
  Starlink: 'Starlink',
  Swarm: 'Swarm',
  Weather: 'Weather',
  'X-Comm': 'X-Comm',
  Other: 'Other',
};

/** All available category keys (excluding "All" which is a compound fetch). */
export const CATEGORY_KEYS = Object.keys(SATELLITE_DATA_URLS).filter(k => k !== 'All');

/** Get display name for a category key. */
export function categoryDisplayName(key: string): string {
  return CATEGORY_DISPLAY_NAMES[key] || key;
}

// ── TLE/CSV Parsing (mirrors DataParser.kt) ──

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDayOfYear(year: number, month: number, dayOfMonth: number): number {
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonth.slice(0, month - 1).reduce((a, b) => a + b, 0) + dayOfMonth;
}

export function parseCSV(text: string): OrbitalData[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const results: OrbitalData[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = lines[i].split(',');
      const name = values[0];
      const timestamp = values[2];
      const year = parseInt(timestamp.substring(0, 4));
      const month = parseInt(timestamp.substring(5, 7));
      const dayOfMonth = parseInt(timestamp.substring(8, 10));
      const dayInt = getDayOfYear(year, month, dayOfMonth);
      const day = dayInt.toString().padStart(3, '0');
      const hour = parseInt(timestamp.substring(11, 13)) * 3600000;
      const min = parseInt(timestamp.substring(14, 16)) * 60000;
      const sec = parseInt(timestamp.substring(17, 19)) * 1000;
      const ms = parseInt(timestamp.substring(20, 26)) / 1000;
      const frac = ((hour + min + sec + ms) / 86400000).toString().substring(1);
      const epoch = parseFloat(`${year.toString().substring(2)}${day}${frac}`);

      const meanmo = parseFloat(values[3]);
      const orbitalPeriod = 1440 / meanmo;
      const isDeepSpace = orbitalPeriod >= 225;

      const data: OrbitalData = {
        name,
        epoch,
        meanmo,
        eccn: parseFloat(values[4]),
        incl: parseFloat(values[5]),
        raan: parseFloat(values[6]),
        argper: parseFloat(values[7]),
        meanan: parseFloat(values[8]),
        catnum: parseInt(values[11]),
        bstar: parseFloat(values[14]),
        ndot: parseFloat(values[15]),
        // Derived fields
        xincl: (parseFloat(values[5]) * Math.PI) / 180,
        xnodeo: (parseFloat(values[6]) * Math.PI) / 180,
        omegao: (parseFloat(values[7]) * Math.PI) / 180,
        xmo: (parseFloat(values[8]) * Math.PI) / 180,
        xno: (meanmo * 2 * Math.PI) / 1440,
        orbitalPeriod,
        isDeepSpace,
      };
      results.push(data);
    } catch {
      console.warn(`CSV parse error at line ${i}`);
    }
  }
  return results;
}

export function parseTLE(text: string): OrbitalData[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const results: OrbitalData[] = [];

  for (let i = 0; i < lines.length; i += 3) {
    if (i + 2 >= lines.length) break;
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith('1') || !line2.startsWith('2')) continue;

    try {
      const meanmo = parseFloat(line2.substring(52, 63));
      const orbitalPeriod = 1440 / meanmo;

      results.push({
        name: lines[i].trim(),
        epoch: parseFloat(line1.substring(18, 32)),
        meanmo,
        eccn: parseFloat(line2.substring(26, 33)) / 1e7,
        incl: parseFloat(line2.substring(8, 16)),
        raan: parseFloat(line2.substring(17, 25)),
        argper: parseFloat(line2.substring(34, 42)),
        meanan: parseFloat(line2.substring(43, 51)),
        catnum: parseInt(line1.substring(2, 7).trim()),
        bstar: parseFloat(line1.substring(53, 59)) * 1e-5 / Math.pow(10, parseFloat(line1.substring(60, 61))),
        ndot: parseFloat(line1.substring(33, 43).trim()),
        xincl: (parseFloat(line2.substring(8, 16)) * Math.PI) / 180,
        xnodeo: (parseFloat(line2.substring(17, 25)) * Math.PI) / 180,
        omegao: (parseFloat(line2.substring(34, 42)) * Math.PI) / 180,
        xmo: (parseFloat(line2.substring(43, 51)) * Math.PI) / 180,
        xno: (meanmo * 2 * Math.PI) / 1440,
        orbitalPeriod,
        isDeepSpace: orbitalPeriod >= 225,
      });
    } catch {
      console.warn(`TLE parse error at line ${i}`);
    }
  }
  return results;
}

// ── Network fetch ──

class DataUpToDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUpToDateError';
  }
}

function celestrakUrl(originalUrl: string): string {
  if (originalUrl.includes('celestrak.org')) {
    // In dev: use Vite proxy. In production: try direct (may need CORS proxy).
    if (import.meta.env.DEV) {
      return originalUrl.replace('https://celestrak.org', '/api/celestrak');
    }
  }
  if (originalUrl.includes('db.satnogs.org')) {
    if (import.meta.env.DEV) {
      return originalUrl.replace('https://db.satnogs.org', '/api/satnogs');
    }
  }
  return originalUrl;
}

async function fetchText(url: string): Promise<string> {
  const finalUrl = celestrakUrl(url);
  const resp = await fetch(finalUrl);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    // Celestrak returns 403 with "has not updated" when data hasn't changed
    if (resp.status === 403 && body.includes('has not updated')) {
      throw new DataUpToDateError(body.trim());
    }
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  // ZIP files (Classified, McCants) not supported in browser — skip gracefully
  if (url.endsWith('.zip')) {
    throw new Error('ZIP sources not supported in web version — use All download instead');
  }
  return resp.text();
}

export interface FetchResult {
  inserted: number;
  upToDate: boolean;
  message: string;
}

export async function fetchAndStoreSatelliteData(
  urls: string[] = [SATELLITE_DATA_URLS.All],
  category?: string,
): Promise<FetchResult> {
  let totalInserted = 0;
  let upToDate = false;

  for (const url of urls) {
    try {
      const text = await fetchText(url);

      const data = text.includes('OBJECT_NAME,OBJECT_ID,EPOCH')
        ? parseCSV(text)
        : parseTLE(text);

      if (data.length > 0) {
        const tag = category || Object.entries(SATELLITE_DATA_URLS).find(([, u]) => u === url)?.[0] || 'Other';
        await mergeEntries(data, tag);
        totalInserted += data.length;
      }
    } catch (err) {
      if (err instanceof DataUpToDateError) {
        upToDate = true;
      } else {
        console.error(`Failed to fetch from ${url}:`, err);
      }
    }
  }

  const store = useSettingsStore.getState();
  // Always query the real DB count — don't rely on stored state
  const realCount = await db.entries.count();
  const realRadioCount = await db.radios.count();
  store.updateDatabaseState({
    numberOfSatellites: realCount,
    numberOfRadios: realRadioCount,
    updateTimestamp: Date.now(),
  });

  if (upToDate && totalInserted === 0) {
    return { inserted: 0, upToDate: true, message: 'Data is up to date.' };
  }
  return {
    inserted: totalInserted,
    upToDate: false,
    message: totalInserted > 0 ? `Stored ${totalInserted} satellites.` : 'No new data.',
  };
}

export async function fetchTransceivers(url?: string): Promise<SatRadio[]> {
  let finalUrl = url || useSettingsStore.getState().dataSourcesSettings.transceiversUrl;
  // Fix old persisted proxy-path URLs and any other bad URLs
  if (
    finalUrl.startsWith('/api/satnogs') ||
    finalUrl.startsWith('/api/') ||
    !finalUrl.startsWith('http')
  ) {
    finalUrl = 'https://db.satnogs.org/api/transmitters/?format=json';
  }
  // Use proxy in dev mode, direct URL in production
  finalUrl = celestrakUrl(finalUrl);
  try {
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    // Log first 100 chars for debugging parse issues
    if (text.length > 0 && (text[0] !== '[' || text[text.length - 1] !== ']')) {
      console.warn('Transceiver response does not look like JSON array:', text.substring(0, 200));
    }
    let radios: SatRadio[];
    try {
      radios = JSON.parse(text);
    } catch {
      // Try to extract the first valid JSON array from the response
      const start = text.indexOf('[');
      if (start >= 0) {
        let depth = 0;
        let end = start;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '[') depth++;
          else if (text[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        radios = JSON.parse(text.substring(start, end));
      } else {
        throw new Error(`Response is not JSON. First 200 chars: ${text.substring(0, 200)}`);
      }
    }
    // Map SatNOGS API field names to our SatRadio format
    const mapped: SatRadio[] = radios.map((r: any) => ({
      uuid: r.uuid || '',
      name: r.description || r.name || '',
      description: r.description || '',
      downlinkLow: r.downlink_low ?? r.downlinkLow ?? null,
      downlinkHigh: r.downlink_high ?? r.downlinkHigh ?? null,
      uplinkLow: r.uplink_low ?? r.uplinkLow ?? null,
      uplinkHigh: r.uplink_high ?? r.uplinkHigh ?? null,
      mode: r.mode ?? null,
      ctcss: r.ctcss ?? null,
      noradCatId: r.norad_cat_id ?? r.noradCatId ?? 0,
    }));

    if (mapped.length > 0) {
      await insertRadios(mapped);
      useSettingsStore.getState().updateDatabaseState({
        ...useSettingsStore.getState().databaseState,
        numberOfRadios: mapped.length,
        updateTimestamp: Date.now(),
      });
    }
    return mapped;
  } catch (err) {
    console.error('Failed to fetch transceivers:', err);
    return [];
  }
}
