import { create } from 'zustand';
import type { OrbitalPass } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds } from '../../data/database';
import { calculatePasses } from '../../domain/wasmBridge';
import { formatTimer } from '../../lib/time';

const CHUNK_SIZE = 8;   // satellites per chunk — keep UI responsive
const YIELD_MS = 1;     // yield to event loop between chunks

interface PassesState {
  isPassesDialogShown: boolean;
  isRefreshing: boolean;
  nextPass: OrbitalPass | null;
  selectedPass: OrbitalPass | null;
  nextTime: string;
  isNextTimeAos: boolean;
  hours: number;
  elevation: number;
  showDeepSpace: boolean;
  itemsList: OrbitalPass[];
  shouldSeeWhatsNew: boolean;
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
  togglePassesDialog: () => void;
}

// Monotonic token invalidating in-flight refreshes when cancelled or restarted.
let refreshToken = 0;

export const usePassesStore = create<PassesState>()((set, get) => ({
  isPassesDialogShown: false,
  isRefreshing: true,
  nextPass: null,
  selectedPass: null,
  nextTime: '--:--:--',
  isNextTimeAos: true,
  hours: 12,
  elevation: 16,
  showDeepSpace: true,
  itemsList: [],
  shouldSeeWhatsNew: false,
  calcProgress: 0,
  calcTotal: 0,

  refreshPasses: async () => {
    const token = ++refreshToken;
    set({ isRefreshing: true, calcProgress: 0, calcTotal: 0 });

    try {
      const settings = useSettingsStore.getState();
      set({ shouldSeeWhatsNew: settings.otherSettings.shouldSeeWhatsNew });

      const selectedIds = useSelectedStore.getState().selectedIds;
      if (selectedIds.length === 0) {
        if (token === refreshToken) {
          set({ isRefreshing: false, itemsList: [], nextPass: null });
        }
        return;
      }

      const entries = await getEntriesWithIds(selectedIds);
      if (token !== refreshToken) {
        set({ isRefreshing: false });
        return;
      }
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
        if (token !== refreshToken) break;

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
        if (token !== refreshToken) {
          set({ isRefreshing: false });
          return;
        }

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

      if (token !== refreshToken) {
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
        nextPass,
        calcProgress: total,
      });

      // Trigger initial timer update
      get().tickTimers();
    } catch (err) {
      console.error('Failed to refresh passes:', err);
      if (token === refreshToken) set({ isRefreshing: false });
    }
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
    } else {
      usePassesStore.setState({ nextTime: '--:--:--', isNextTimeAos: true });
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
        ? { itemsList: updated, selectedPass, nextPass }
        : {};
    });
  },

  cancelRefresh: () => {
    refreshToken++;
    // Hide the progress UI immediately; the in-flight run is token-guarded.
    set({ isRefreshing: false });
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
      .find((p) => p.aosTime > now)
      || itemsList.find((p) => p.catNum === catNum && p.losTime > now)
      || null;
    set({ selectedPass: pass });
  },

  resetSelectedPass: () => set({ selectedPass: null }),

  filterPasses: (hours, elevation, showDeepSpace) => {
    set({ hours, elevation, showDeepSpace });
    // Persist so other features (radar) share the same pass filters.
    useSettingsStore.getState().setPassesSettings({
      ...useSettingsStore.getState().passesSettings,
      hoursAhead: hours,
      minElevation: elevation,
      showDeepSpace,
    });
  },

  togglePassesDialog: () =>
    set((s) => ({ isPassesDialogShown: !s.isPassesDialogShown })),
}));
