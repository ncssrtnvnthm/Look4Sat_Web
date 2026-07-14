import { create } from 'zustand';
import type { SatItem } from '../../domain/types';
import { getAllEntriesWithCategories } from '../../data/database';
import { useSelectedStore, useSettingsStore } from '../../data/stores';
import { categoryDisplayName } from '../../data/satelliteData';

interface SatellitesState {
  isDialogShown: boolean;
  isLoading: boolean;
  shouldSeeWarning: boolean;
  itemsList: SatItem[];
  currentCategories: string[];
  availableCategories: { key: string; label: string }[];
  searchQuery: string;

  // Actions
  loadSatellites: () => Promise<void>;
  dismissWarning: () => void;
  toggleTypesDialog: () => void;
  setSearchQuery: (query: string) => void;
  selectAll: () => void;
  selectFiltered: () => void;
  unselectAll: () => void;
  selectSingle: (id: number, ticked: boolean) => void;
  setCategories: (categories: string[]) => void;
  saveSelection: () => void;
}

export const useSatellitesStore = create<SatellitesState>()((set, get) => ({
  isDialogShown: false,
  isLoading: true,
  shouldSeeWarning: false,
  itemsList: [],
  currentCategories: [],
  availableCategories: [],
  searchQuery: '',

  loadSatellites: async () => {
    set({ isLoading: true });
    const settings = useSettingsStore.getState();
    set({ shouldSeeWarning: settings.otherSettings.shouldSeeWarning });

    const entries = await getAllEntriesWithCategories();
    const selectedIds = useSelectedStore.getState().selectedIds;
    const selectedSet = new Set(selectedIds);

    const items: SatItem[] = entries.map((e) => ({
      catnum: e.catnum,
      name: e.name,
      isSelected: selectedSet.has(e.catnum),
      categories: e.categories || [],
    }));

    items.sort((a, b) => a.name.localeCompare(b.name));

    // Build available categories from actual data, not hardcoded list
    const catCounts = new Map<string, number>();
    for (const item of items) {
      for (const cat of item.categories) {
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      }
    }
    const availableCategories = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1]) // most populous first
      .map(([key, count]) => ({
        key,
        label: `${categoryDisplayName(key)} (${count})`,
      }));

    set({
      itemsList: items,
      availableCategories,
      currentCategories: useSelectedStore.getState().selectedTypes,
      isLoading: false,
    });
  },

  dismissWarning: () => {
    useSettingsStore.getState().updateOtherSettings((s) => ({
      ...s,
      shouldSeeWarning: false,
    }));
    set({ shouldSeeWarning: false });
  },

  toggleTypesDialog: () => set((s) => ({ isDialogShown: !s.isDialogShown })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  selectAll: () =>
    set((s) => ({
      itemsList: s.itemsList.map((item) => ({ ...item, isSelected: true })),
    })),

  selectFiltered: () => {
    const state = get();
    const filteredCatnums = new Set(getFilteredItems(state).map((i) => i.catnum));
    set({
      itemsList: state.itemsList.map((item) => ({
        ...item,
        isSelected: filteredCatnums.has(item.catnum) ? true : item.isSelected,
      })),
    });
  },

  unselectAll: () =>
    set((s) => ({
      itemsList: s.itemsList.map((item) => ({ ...item, isSelected: false })),
    })),

  selectSingle: (id, ticked) =>
    set((s) => ({
      itemsList: s.itemsList.map((item) =>
        item.catnum === id ? { ...item, isSelected: ticked } : item,
      ),
    })),

  setCategories: (categories) => set({ currentCategories: categories }),

  saveSelection: () => {
    const { itemsList, currentCategories } = get();
    const selectedIds = itemsList.filter((i) => i.isSelected).map((i) => i.catnum);
    useSelectedStore.getState().setSelectedIds(selectedIds);
    useSelectedStore.getState().setSelectedTypes(currentCategories);
  },
}));

// ── Filtered items selector ──

export function getFilteredItems(state: SatellitesState): SatItem[] {
  const { itemsList, searchQuery, currentCategories } = state;
  let filtered = itemsList;

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.catnum.toString().includes(q),
    );
  }

  if (currentCategories.length > 0) {
    filtered = filtered.filter((item) =>
      currentCategories.some((cat) => item.categories.includes(cat)),
    );
  }

  return filtered;
}
