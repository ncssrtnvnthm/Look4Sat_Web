import { create } from 'zustand';
import type { OrbitalPass } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds } from '../../data/database';
import { calculatePasses } from '../../domain/wasmBridge';

const CHUNK_SIZE = 8;   // satellites per chunk — keep UI responsive
const YIELD_MS = 1;     // yield to event loop between chunks

interface PassesState {
  isPassesDialogShown: boolean;
  isRadiosDialogShown: boolean;
  isRefreshing: boolean;
  nextPass: OrbitalPass | null;
  selectedPass: OrbitalPass | null;
  nextTime: string;
  isNextTimeAos: boolean;
  hours: number;
  elevation: number;
  showDeepSpace: boolean;
  modes: string[];
  itemsList: OrbitalPass[];
  groupedPasses: Record<string, OrbitalPass[]>;
  shouldSeeWhatsNew: boolean;
  sunTimes: Record<string, [string, string]>;
  /** Pass calculation progress — processed satellite count */
  calcProgress: number;
  calcTotal: number;

  refreshPasses: () => Promise<void>;
  cancelRefresh: () => void;
  tickTimers: () => void;
  dismissWhatsNew: () => void;
  selectPass: (catNum: number) => void;
  resetSelectedPass: () => void;
  filterPasses: (hours: number, elevation: number, showDeepSpace: boolean) => void;
  filterRadios: (modes: string[]) => void;
  togglePassesDialog: () => void;
  toggleRadiosDialog: () => void;
}

// Abort handle for cancelling an in-flight refresh
let refreshAbort = false;

export const usePassesStore = create<PassesState>()((set, get) => ({
  isPassesDialogShown: false,
  isRadiosDialogShown: false,
  isRefreshing: true,
  nextPass: null,
  selectedPass: null,
  nextTime: '00:00:00',
  isNextTimeAos: true,
  hours: 12,
  elevation: 16,
  showDeepSpace: true,
  modes: [],
  itemsList: [],
  groupedPasses: {},
  shouldSeeWhatsNew: false,
  sunTimes: {},
  calcProgress: 0,
  calcTotal: 0,

  refreshPasses: async () => {
    refreshAbort = false;
    set({ isRefreshing: true, calcProgress: 0, calcTotal: 0 });

    const settings = useSettingsStore.getState();
    set({
      shouldSeeWhatsNew: settings.otherSettings.shouldSeeWhatsNew,
    });

    const selectedIds = useSelectedStore.getState().selectedIds;
    if (selectedIds.length === 0) {
      set({ isRefreshing: false, itemsList: [], groupedPasses: {} });
      return;
    }

    const entries = await getEntriesWithIds(selectedIds);
    const { latitude, longitude, altitude } = settings.stationPosition;
    const { hours: hoursAhead, elevation: minElevation, showDeepSpace } = get();
    const now = getAdjustedTime();
    const endTime = now + hoursAhead * 3600000;

    // Filter entries
    const toProcess = showDeepSpace
      ? entries
      : entries.filter((e) => !e.isDeepSpace);

    const total = toProcess.length;
    set({ calcTotal: total });

    const allPasses: OrbitalPass[] = [];

    // Process in chunks, yielding to the event loop between chunks
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      if (refreshAbort) break;

      const chunk = toProcess.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((entry) =>
          calculatePasses(
            JSON.stringify(entry),
            latitude, longitude, altitude,
            now, endTime, minElevation,
          ),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.type === 'calculatePasses') {
          for (const wp of result.value.result) {
            allPasses.push({
              aosTime: wp.aosTime,
              aosAzimuth: wp.aosAzimuth,
              losTime: wp.losTime,
              losAzimuth: wp.losAzimuth,
              altitude: wp.altitude,
              maxElevation: wp.maxElevation,
              catNum: wp.catNum,
              name: wp.name,
              isDeepSpace: wp.isDeepSpace,
              progress: 0,
              hasDecayed: wp.hasDecayed,
            });
          }
        }
      }

      // Update progress and yield to event loop
      set({ calcProgress: Math.min(i + CHUNK_SIZE, total) });

      if (i + CHUNK_SIZE < total) {
        await new Promise((r) => setTimeout(r, YIELD_MS));
      }
    }

    if (refreshAbort) {
      set({ isRefreshing: false });
      return;
    }

    allPasses.sort((a, b) => a.aosTime - b.aosTime);

    // Remove already-ended passes
    const upcomingPasses = allPasses.filter((p) => p.losTime > now);

    for (const pass of upcomingPasses) {
      if (now >= pass.aosTime && now <= pass.losTime) {
        pass.progress = (now - pass.aosTime) / (pass.losTime - pass.aosTime);
      }
    }

    const nextPass = upcomingPasses.find((p) => p.aosTime > now) || upcomingPasses[0] || null;

    set({
      isRefreshing: false,
      itemsList: upcomingPasses,
      groupedPasses: groupPassesByDate(upcomingPasses),
      nextPass,
      calcProgress: total,
    });

    // Trigger initial timer update
    get().tickTimers();
  },

  tickTimers: () => {
    const { nextPass, selectedPass } = get();
    const pass = selectedPass ?? nextPass;
    const now = getAdjustedTime();

    if (pass) {
      if (now < pass.aosTime) {
        usePassesStore.setState({
          nextTime: formatTimer(pass.aosTime - now),
          isNextTimeAos: true,
        });
      } else if (now < pass.losTime) {
        usePassesStore.setState({
          nextTime: formatTimer(pass.losTime - now),
          isNextTimeAos: false,
        });
      }
    }

    // Update progress for active passes (functional update to avoid races)
    usePassesStore.setState((state) => {
      let changed = false;
      const filtered = state.itemsList.filter((p) => {
        if (p.losTime <= now) {
          changed = true;
          return false; // remove ended passes
        }
        return true;
      });
      const updated = filtered.map((p) => {
        if (now >= p.aosTime && now <= p.losTime) {
          const newProg = (now - p.aosTime) / (p.losTime - p.aosTime);
          if (Math.abs(newProg - p.progress) > 0.001) {
            changed = true;
            return { ...p, progress: newProg };
          }
        } else if (p.progress !== 0) {
          changed = true;
          return { ...p, progress: 0 };
        }
        return p;
      });

      // If selectedPass or nextPass was removed, find the next one
      let { selectedPass, nextPass } = state;
      if (selectedPass && selectedPass.losTime <= now) {
        selectedPass = updated.find((p) => p.aosTime > now) || updated[0] || null;
        changed = true;
      }
      if (nextPass && nextPass.losTime <= now) {
        nextPass = updated.find((p) => p.aosTime > now) || updated[0] || null;
        changed = true;
      }

      return changed
        ? { itemsList: updated, groupedPasses: groupPassesByDate(updated), selectedPass, nextPass }
        : {};
    });
  },

  cancelRefresh: () => {
    refreshAbort = true;
  },

  dismissWhatsNew: () => {
    useSettingsStore.getState().updateOtherSettings((s) => ({
      ...s,
      shouldSeeWhatsNew: false,
    }));
    set({ shouldSeeWhatsNew: false });
  },

  selectPass: (catNum: number) => {
    const { itemsList } = get();
    const now = getAdjustedTime();
    const pass = itemsList
      .filter((p) => p.catNum === catNum)
      .sort((a, b) => a.aosTime - b.aosTime)
      .find((p) => p.aosTime > now) || itemsList.find((p) => p.catNum === catNum) || null;
    set({ selectedPass: pass });
  },

  resetSelectedPass: () => set({ selectedPass: null }),

  filterPasses: (hours, elevation, showDeepSpace) =>
    set({ hours, elevation, showDeepSpace }),

  filterRadios: (modes) => set({ modes }),

  togglePassesDialog: () =>
    set((s) => ({ isPassesDialogShown: !s.isPassesDialogShown })),

  toggleRadiosDialog: () =>
    set((s) => ({ isRadiosDialogShown: !s.isRadiosDialogShown })),
}));

// ── Format helpers ──

function formatTimer(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPassTime(ms: number, isUtc: boolean): string {
  const date = new Date(ms);
  return isUtc
    ? date.toISOString().substring(11, 19)
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function groupPassesByDate(passes: OrbitalPass[]): Record<string, OrbitalPass[]> {
  const groups: Record<string, OrbitalPass[]> = {};
  for (const pass of passes) {
    const key = formatDate(pass.aosTime);
    if (!groups[key]) groups[key] = [];
    groups[key].push(pass);
  }
  return groups;
}
