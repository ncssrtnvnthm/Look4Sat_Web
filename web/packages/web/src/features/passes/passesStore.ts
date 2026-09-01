import { create } from 'zustand';
import type { OrbitalPass } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds, getModesForIds } from '../../data/database';
import { calculatePasses, getSunTimes } from '../../domain/wasmBridge';
import { formatTimer, formatPassTime } from '../../lib/time';

const CHUNK_SIZE = 8;   // satellites per chunk — keep UI responsive
const YIELD_MS = 1;     // yield to event loop between chunks

export interface SunTimes {
  sunrise: number; // epoch ms, 0 = not found (polar day/night)
  sunset: number;
}

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
  /** Selected radio modes; when non-empty, only satellites with a matching
   *  transponder mode are considered (empty = all). */
  modes: string[];
  /** Distinct radio modes available for filtering (from the transceiver DB). */
  availableModes: string[];
  itemsList: OrbitalPass[];
  /** Sunrise/sunset (epoch ms) for the day of the active pass. */
  sunTimes: SunTimes | null;
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
  filterModes: (modes: string[]) => void;
  togglePassesDialog: () => void;
}

/** Format an epoch-ms time as HH:MM in UTC or local (for sun times). */
export function formatSunTime(ms: number, isUtc: boolean): string {
  if (ms <= 0) return '—';
  return formatPassTime(ms, isUtc).substring(0, 5);
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
  modes: [],
  availableModes: [],
  itemsList: [],
  sunTimes: null,
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
      const { hours: hoursAhead, elevation: minElevation, showDeepSpace, modes } = get();
      const now = getAdjustedTime();
      const endTime = now + hoursAhead * 3600000;

      // Distinct radio modes available for the selected satellites (filter UI).
      const modesById = await getModesForIds(selectedIds);
      if (token !== refreshToken) {
        set({ isRefreshing: false });
        return;
      }
      const availableModes = [...new Set([...modesById.values()].flatMap((s) => [...s]))].sort();
      set({ availableModes });

      // Filter entries: deep-space toggle, then transponder modes.
      let toProcess = showDeepSpace
        ? entries
        : entries.filter((e) => !e.isDeepSpace);
      if (modes.length > 0) {
        const modeSet = new Set(modes);
        toProcess = toProcess.filter((e) => {
          const entryModes = modesById.get(e.catnum);
          return entryModes != null && [...entryModes].some((m) => modeSet.has(m));
        });
      }

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

      // Sunrise/sunset for the active pass's day (start from the previous day
      // so we get that day's rise/set pair).
      if (nextPass) {
        getSunTimes(latitude, longitude, nextPass.aosTime - 24 * 3600 * 1000)
          .then((resp) => {
            if (token !== refreshToken) return;
            if (resp.type === 'getSunTimes') {
              usePassesStore.setState({ sunTimes: resp.result });
            }
          })
          .catch(() => { /* keep previous sun times */ });
      }

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
    if (pass) {
      const { latitude, longitude } = useSettingsStore.getState().stationPosition;
      getSunTimes(latitude, longitude, pass.aosTime - 24 * 3600 * 1000)
        .then((resp) => {
          if (resp.type === 'getSunTimes') {
            usePassesStore.setState({ sunTimes: resp.result });
          }
        })
        .catch(() => { /* keep previous sun times */ });
    }
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

  filterModes: (modes) => {
    set({ modes });
    useSettingsStore.getState().setPassesSettings({
      ...useSettingsStore.getState().passesSettings,
      selectedModes: modes,
    });
  },

  togglePassesDialog: () =>
    set((s) => ({ isPassesDialogShown: !s.isPassesDialogShown })),
}));
