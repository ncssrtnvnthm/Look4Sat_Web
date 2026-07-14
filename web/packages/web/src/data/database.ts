import Dexie, { type EntityTable } from 'dexie';
import type { OrbitalData, SatRadio } from '../domain/types';

interface SatEntry {
  catnum: number;
  name: string;
  categories: string[];
  data: OrbitalData;
}

interface RadioEntry {
  uuid: string;
  satId: number;
  data: SatRadio;
}

class Look4SatDB extends Dexie {
  entries!: EntityTable<SatEntry, 'catnum'>;
  radios!: EntityTable<RadioEntry, 'uuid'>;

  constructor() {
    super('Look4SatDB');
    this.version(2).stores({
      entries: 'catnum, name, *categories',
      radios: 'uuid, satId',
    }).upgrade(tx => {
      // Add categories field to existing entries (empty array default)
      return tx.table('entries').toCollection().modify(entry => {
        if (!entry.categories) entry.categories = [];
      });
    });
  }
}

export const db = new Look4SatDB();

// ── Satellite data operations ──

export async function getEntriesTotal(): Promise<number> {
  return db.entries.count();
}

export async function getEntriesWithIds(ids: number[]): Promise<OrbitalData[]> {
  const entries = await db.entries.bulkGet(ids);
  return entries.filter(Boolean).map((e) => e!.data);
}

export async function getAllEntries(): Promise<OrbitalData[]> {
  const entries = await db.entries.toArray();
  return entries.map((e) => e.data);
}

export interface SatEntryWithCategory {
  catnum: number;
  name: string;
  categories: string[];
  data: OrbitalData;
}

export async function getAllEntriesWithCategories(): Promise<SatEntryWithCategory[]> {
  return db.entries.toArray();
}

export async function insertEntries(entries: OrbitalData[], category?: string): Promise<void> {
  await db.entries.bulkPut(
    entries.map((data) => ({
      catnum: data.catnum,
      name: data.name,
      categories: category ? [category] : [],
      data,
    })),
  );
}

/**
 * Merge new entries into the database, preserving existing categories
 * and adding the new category tag without overwriting existing ones.
 */
export async function mergeEntries(entries: OrbitalData[], category: string): Promise<void> {
  const existing = await db.entries.bulkGet(entries.map(e => e.catnum));
  const existingMap = new Map(existing.filter(Boolean).map(e => [e!.catnum, e!]));

  await db.entries.bulkPut(
    entries.map((data) => {
      const prev = existingMap.get(data.catnum);
      const categories = prev
        ? [...new Set([...prev.categories, category])]
        : [category];
      return { catnum: data.catnum, name: data.name, categories, data };
    }),
  );
}

export async function deleteAllEntries(): Promise<void> {
  await db.entries.clear();
}

// ── Radio/transceiver operations ──

export async function getRadiosTotal(): Promise<number> {
  return db.radios.count();
}

export async function getRadiosWithId(satId: number): Promise<SatRadio[]> {
  const radios = await db.radios.where('satId').equals(satId).toArray();
  return radios.map((r) => r.data);
}

export async function insertRadios(radios: SatRadio[]): Promise<void> {
  await db.radios.bulkPut(
    radios.map((data) => ({
      uuid: data.uuid,
      satId: data.noradCatId,
      data,
    })),
  );
}

export async function deleteAllRadios(): Promise<void> {
  await db.radios.clear();
}
