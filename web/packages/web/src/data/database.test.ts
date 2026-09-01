import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, mergeEntries, getAllEntriesWithCategories } from './database';
import type { OrbitalData } from '../domain/types';

function makeSat(catnum: number, name: string): OrbitalData {
  return {
    name,
    epoch: 26243.5,
    meanmo: 15.5,
    eccn: 0.0005,
    incl: 51.64,
    raan: 120,
    argper: 60,
    meanan: 90,
    catnum,
    bstar: 0.0001,
    ndot: 0,
    xincl: 0.9,
    xnodeo: 2.09,
    omegao: 1.05,
    xmo: 1.57,
    xno: 0.0676,
    orbitalPeriod: 92.9,
    isDeepSpace: false,
  };
}

beforeEach(async () => {
  await db.entries.clear();
  await db.radios.clear();
});

describe('mergeEntries', () => {
  it('inserts new entries with the category tag', async () => {
    await mergeEntries([makeSat(1, 'SAT A')], 'Cubesat');
    const all = await getAllEntriesWithCategories();
    expect(all).toHaveLength(1);
    expect(all[0].catnum).toBe(1);
    expect(all[0].categories).toEqual(['Cubesat']);
  });

  it('preserves existing categories when adding a new tag', async () => {
    await mergeEntries([makeSat(1, 'SAT A')], 'Cubesat');
    await mergeEntries([makeSat(1, 'SAT A')], 'Amateur');
    const all = await getAllEntriesWithCategories();
    expect(all).toHaveLength(1);
    expect([...all[0].categories].sort()).toEqual(['Amateur', 'Cubesat']);
  });

  it('upserts fresh orbital data without duplicating entries', async () => {
    await mergeEntries([makeSat(1, 'SAT A')], 'Cubesat');
    await mergeEntries([{ ...makeSat(1, 'SAT A NEW NAME') }], 'Cubesat');
    const all = await getAllEntriesWithCategories();
    expect(all).toHaveLength(1);
    expect(all[0].data.name).toBe('SAT A NEW NAME');
  });

  it('skips entries with invalid catalog numbers instead of failing the batch', async () => {
    const bad = { ...makeSat(Number.NaN, 'BAD') };
    await mergeEntries([bad, makeSat(2, 'SAT B')], 'Cubesat');
    const all = await getAllEntriesWithCategories();
    expect(all.map((e) => e.catnum)).toEqual([2]);
  });
});
