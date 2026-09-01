import { describe, it, expect } from 'vitest';
import { parseCSV, parseTLE, celestrakUrl, validateAllCatalogSize, SATELLITE_DATA_URLS } from './satelliteData';

const CSV_HEADER =
  'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';

const CSV_ROW = (name: string, id: string, epoch: string, catnum: number) =>
  `${name},${id},${epoch},15.5,.0005,51.64,120.0,60.0,90.0,0,U,${catnum},999,8172,.0001,0,0`;

describe('parseCSV', () => {
  it('parses a Celestrak OMM/CSV row into OrbitalData', () => {
    const text = [CSV_HEADER, CSV_ROW('ISS (ZARYA)', '1998-067A', '2026-08-31T01:02:28.311936', 25544)].join('\n');
    const [sat] = parseCSV(text);

    expect(sat.name).toBe('ISS (ZARYA)');
    expect(sat.catnum).toBe(25544);
    expect(sat.meanmo).toBeCloseTo(15.5, 6);
    expect(sat.orbitalPeriod).toBeCloseTo(1440 / 15.5, 6);
    expect(sat.isDeepSpace).toBe(false);
    expect(sat.incl).toBeCloseTo(51.64, 6);
    // Derived radians
    expect(sat.xincl).toBeCloseTo((51.64 * Math.PI) / 180, 9);
    expect(sat.xno).toBeCloseTo((15.5 * 2 * Math.PI) / 1440, 9);
    // Epoch: year 26, day 243 (Aug 31), fraction of 01:02:28.311936
    const expectedEpoch = 26243 + (1 * 3600 + 2 * 60 + 28.311936) / 86400;
    expect(sat.epoch).toBeCloseTo(expectedEpoch, 6);
  });

  it('parses the fractional seconds for any digit count (3, 6, 9) and trailing Z', () => {
    // 3-digit fraction without timezone
    const t3 = [CSV_HEADER, CSV_ROW('A', '2024-001A', '2026-08-31T01:02:28.789', 1)].join('\n');
    // 9-digit fraction (nanoseconds — must truncate to microseconds, not overflow)
    const t9 = [CSV_HEADER, CSV_ROW('B', '2024-001B', '2026-08-31T01:02:28.789123456', 2)].join('\n');
    // trailing Z
    const tz = [CSV_HEADER, CSV_ROW('C', '2024-001C', '2026-08-31T01:02:28.789Z', 3)].join('\n');

    const e3 = parseCSV(t3)[0].epoch;
    const e9 = parseCSV(t9)[0].epoch;
    const ez = parseCSV(tz)[0].epoch;
    // All three represent 28.789 s into the minute
    const expected = 26243 + (1 * 3600 + 2 * 60 + 28.789) / 86400;
    expect(e3).toBeCloseTo(expected, 6);
    expect(e9).toBeCloseTo(expected, 6);
    expect(ez).toBeCloseTo(expected, 6);
  });

  it('skips the header line and garbage rows without throwing', () => {
    const text = `${CSV_HEADER}\nNOT-A-CSV-LINE\n${CSV_ROW('X', '2024-001X', '2026-08-31T01:02:28.311936', 9)}\n`;
    const parsed = parseCSV(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].catnum).toBe(9);
  });
});

describe('parseTLE', () => {
  const TLE = `ISS (ZARYA)
1 25544U 98067A   26243.50000000  .00016717  00000-0  10270-3 0  9995
2 25544  51.6400 120.0000 0005000  60.0000  90.0000 15.50000000000000`;

  it('parses a 3-line TLE into OrbitalData', () => {
    const [sat] = parseTLE(TLE);
    expect(sat.name).toBe('ISS (ZARYA)');
    expect(sat.catnum).toBe(25544);
    expect(sat.meanmo).toBeCloseTo(15.5, 6);
    expect(sat.incl).toBeCloseTo(51.64, 6);
    expect(sat.eccn).toBeCloseTo(0.0005, 9);
    expect(sat.epoch).toBeCloseTo(26243.5, 6);
    expect(sat.isDeepSpace).toBe(false);
  });

  it('decodes the BSTAR drag term (" 10270-3" → 1.027e-4)', () => {
    const [sat] = parseTLE(TLE);
    expect(sat.bstar).toBeCloseTo(0.0001027, 10);
  });

  it('decodes the mean-motion derivative', () => {
    const [sat] = parseTLE(TLE);
    expect(sat.ndot).toBeCloseTo(0.00016717, 9);
  });

  it('strips a leading "0 " from TLE names', () => {
    const withPrefix = TLE.replace('ISS (ZARYA)', '0 ISS (ZARYA)');
    const [sat] = parseTLE(withPrefix);
    expect(sat.name).toBe('ISS (ZARYA)');
  });

  it('marks deep-space objects by orbital period', () => {
    const geo = `GEO
1 99999U 00000A   26243.50000000  .00000000  00000-0  00000-0 0  9996
2 99999   0.1000 100.0000 0001000  50.0000 200.0000  1.00270000000000`;
    const [sat] = parseTLE(geo);
    expect(sat.isDeepSpace).toBe(true);
  });
});

describe('celestrakUrl', () => {
  const celestrak = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv';
  const satnogs = 'https://db.satnogs.org/api/transmitters/?format=json';

  it('rewrites Celestrak through the dev proxy in dev mode', () => {
    expect(celestrakUrl(celestrak, true)).toBe('/api/celestrak/NORAD/elements/gp.php?GROUP=active&FORMAT=csv');
  });

  it('keeps the direct URL in production', () => {
    expect(celestrakUrl(celestrak, false)).toBe(celestrak);
    expect(celestrakUrl(satnogs, false)).toBe(satnogs);
  });

  it('rewrites SatNOGS through the dev proxy in dev mode', () => {
    expect(celestrakUrl(satnogs, true)).toBe('/api/satnogs/api/transmitters/?format=json');
  });
});

describe('validateAllCatalogSize', () => {
  it('rejects a truncated "All" download', () => {
    const err = validateAllCatalogSize(SATELLITE_DATA_URLS.All, 2000);
    expect(err).toContain('Incomplete response');
    expect(err).toContain('2000');
  });

  it('accepts a full "All" download', () => {
    expect(validateAllCatalogSize(SATELLITE_DATA_URLS.All, 9500)).toBeNull();
  });

  it('does not apply the floor to small category downloads', () => {
    expect(validateAllCatalogSize('https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=csv', 300)).toBeNull();
  });
});
