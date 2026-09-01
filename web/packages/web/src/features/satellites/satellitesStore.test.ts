import { describe, it, expect } from 'vitest';
import { getFilteredItems } from './satellitesStore';
import type { SatItem } from '../../domain/types';

function item(catnum: number, name: string, categories: string[]): SatItem {
  return { catnum, name, isSelected: false, categories };
}

const state = {
  itemsList: [
    item(25544, 'ISS (ZARYA)', ['Amateur', 'Cubesat']),
    item(40069, 'STARLINK-1007', ['Starlink']),
    item(43013, 'FOX-1CLIFF', ['Amateur']),
    item(25560, 'IRIDIUM 16', ['Iridium']),
  ],
  searchQuery: '',
  currentCategories: [],
} as unknown as Parameters<typeof getFilteredItems>[0];

describe('getFilteredItems', () => {
  it('returns everything with no filters', () => {
    expect(getFilteredItems(state)).toHaveLength(4);
  });

  it('filters by name substring (case-insensitive)', () => {
    expect(getFilteredItems({ ...state, searchQuery: 'star' }).map((i) => i.catnum)).toEqual([40069]);
    expect(getFilteredItems({ ...state, searchQuery: 'ISS' }).map((i) => i.catnum)).toEqual([25544]);
  });

  it('filters by catalog number substring', () => {
    expect(getFilteredItems({ ...state, searchQuery: '2554' }).map((i) => i.catnum)).toEqual([25544]);
  });

  it('filters by category (OR within the selected set)', () => {
    const filtered = getFilteredItems({ ...state, currentCategories: ['Amateur'] });
    expect(filtered.map((i) => i.catnum).sort()).toEqual([25544, 43013].sort());
  });

  it('combines search and category filters', () => {
    const filtered = getFilteredItems({ ...state, searchQuery: 'iss', currentCategories: ['Cubesat'] });
    expect(filtered.map((i) => i.catnum)).toEqual([25544]);
  });
});
