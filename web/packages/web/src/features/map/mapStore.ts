import { create } from 'zustand';
import type { OrbitalPass, GeoPos, OrbitalPos, OrbitalData } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds } from '../../data/database';
import { getPosition, getSunPosition, getMoonPosition } from '../../domain/wasmBridge';

interface MapState {
  selectedSat: OrbitalData | null;
  selectedPass: OrbitalPass | null;
  stationPosition: GeoPos;
  /** Ground track segments (split at dateline). Each segment is [lat, lng][] */
  trackSegments: [number, number][][];
  footprint: OrbitalPos | null;
  isUtc: boolean;
  isLightUi: boolean;
  allSatellites: OrbitalData[];
  sunLat: number;
  sunLon: number;
  moonLat: number;
  moonLon: number;
  selectedIndex: number;
  satLat: number | null;
  satLon: number | null;
  satAlt: number | null;
  _ticking: boolean;

  initMap: () => Promise<void>;
  startTicking: () => void;
  stopTicking: () => void;
  selectPrev: () => void;
  selectNext: () => void;
  selectSatellite: (index: number) => void;
}

export const useMapStore = create<MapState>()((set, get) => ({
  selectedSat: null,
  selectedPass: null,
  stationPosition: { latitude: 0, longitude: 0, altitude: 0 },
  trackSegments: [],
  footprint: null,
  isUtc: false,
  isLightUi: false,
  allSatellites: [],
  sunLat: 0,
  sunLon: 0,
  moonLat: 0,
  moonLon: 0,
  selectedIndex: 0,
  satLat: null,
  satLon: null,
  satAlt: null,
  _ticking: false,

  initMap: async () => {
    const settings = useSettingsStore.getState();
    const selectedIds = useSelectedStore.getState().selectedIds;

    let allSatellites: OrbitalData[] = [];
    if (selectedIds.length > 0) {
      allSatellites = await getEntriesWithIds(selectedIds);
    }

    set({
      stationPosition: settings.stationPosition,
      isUtc: settings.otherSettings.stateOfUtc,
      isLightUi: settings.otherSettings.stateOfLightTheme,
      allSatellites,
      selectedSat: allSatellites[0] || null,
      selectedIndex: 0,
    });

    // Start at the shared viewed index if valid
    if (allSatellites.length > 0) {
      const sharedIdx = Math.min(useSelectedStore.getState().viewedSatIndex, allSatellites.length - 1);
      set({ selectedIndex: sharedIdx, selectedSat: allSatellites[sharedIdx] });
      computeTrack(allSatellites[sharedIdx], settings.stationPosition);
    }

    // Fetch initial sun/moon positions
    updateSunMoon();
  },

  startTicking: () => {
    if (get()._ticking) return;
    set({ _ticking: true });
    scheduleMapTick();
  },

  stopTicking: () => {
    set({ _ticking: false });
  },

  selectPrev: () => {
    const { allSatellites, selectedIndex } = get();
    if (allSatellites.length === 0) return;
    const idx = (selectedIndex - 1 + allSatellites.length) % allSatellites.length;
    const sat = allSatellites[idx];
    set({ selectedIndex: idx, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(idx);
    computeTrack(sat, get().stationPosition);
  },

  selectNext: () => {
    const { allSatellites, selectedIndex } = get();
    if (allSatellites.length === 0) return;
    const idx = (selectedIndex + 1) % allSatellites.length;
    const sat = allSatellites[idx];
    set({ selectedIndex: idx, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(idx);
    computeTrack(sat, get().stationPosition);
  },

  selectSatellite: (index: number) => {
    const { allSatellites } = get();
    if (index < 0 || index >= allSatellites.length) return;
    const sat = allSatellites[index];
    set({ selectedIndex: index, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(index);
    computeTrack(sat, get().stationPosition);
  },
}));

let mapTickTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMapTick() {
  mapTickTimer = setTimeout(() => runMapTick(), 1000);
}

async function runMapTick() {
  const state = useMapStore.getState();
  if (!state._ticking) return;

  const { selectedSat, stationPosition, satLat } = state;
  if (selectedSat && stationPosition.latitude !== 0) {
    try {
      const resp = await getPosition(
        JSON.stringify(selectedSat),
        stationPosition.latitude,
        stationPosition.longitude,
        stationPosition.altitude,
        getAdjustedTime(),
      );
      if (resp.type === 'getPosition' && resp.result) {
        let lon = resp.result.longitude;
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        useMapStore.setState({
          satLat: resp.result.latitude,
          satLon: lon,
          satAlt: resp.result.altitude,
        });
      }
    } catch { /* ignore */ }
  }

  // Update sun/moon every 60s
  if ((Date.now() / 1000 | 0) % 60 === 0) {
    updateSunMoon();
  }

  scheduleMapTick();
}

/**
 * Compute ground track for the selected satellite, ported from
 * Android MapViewModel.getSatTrack().
 *
 * Samples positions every 15 seconds for the next ~2.4 orbital periods,
 * splitting the track at ±180° longitude crossings.
 */
async function computeTrack(sat: OrbitalData, pos: GeoPos) {
  // Don't compute if position is not set
  if (pos.latitude === 0 && pos.longitude === 0) return;

  const orbitalDataJson = JSON.stringify(sat);
  const now = getAdjustedTime();
  const durationMs = sat.orbitalPeriod * 2.4 * 60000;
  const endTime = now + durationMs;
  const stepMs = 15000; // 15-second steps matching Android

  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [];
  let prevLon: number | null = null;
  let successCount = 0;

  for (let t = now; t <= endTime; t += stepMs) {
    try {
      const resp = await getPosition(
        orbitalDataJson, pos.latitude, pos.longitude, pos.altitude, t,
      );
      if (resp.type !== 'getPosition' || !resp.result) continue;
      successCount++;

      let lon = resp.result.longitude;
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;
      const lat = resp.result.latitude;

      // Dateline crossing detection (matches Android logic)
      if (prevLon !== null) {
        if (prevLon < -170 && lon > 170) {
          currentSegment.push([lat, -180]);
          segments.push(currentSegment);
          currentSegment = [[lat, 180]];
        } else if (prevLon > 170 && lon < -170) {
          currentSegment.push([lat, 180]);
          segments.push(currentSegment);
          currentSegment = [[lat, -180]];
        }
      }

      currentSegment.push([lat, lon]);
      prevLon = lon;
    } catch {
      // Skip failed position fetches
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // If all fetches failed (bridge not loaded yet), retry after delay
  if (successCount === 0) {
    setTimeout(() => {
      const state = useMapStore.getState();
      if (state.selectedSat?.catnum === sat.catnum) {
        computeTrack(sat, pos);
      }
    }, 2000);
    return;
  }

  useMapStore.setState({ trackSegments: segments });
}

async function updateSunMoon() {
  try {
    const store = useMapStore.getState();
    const { latitude, longitude } = store.stationPosition;
    const now = getAdjustedTime();
    const [sunResp, moonResp] = await Promise.all([
      getSunPosition(latitude, longitude, now),
      getMoonPosition(latitude, longitude, now),
    ]);
    if (sunResp.type === 'getSunPosition') {
      useMapStore.setState({
        sunLat: sunResp.result.latitude,
        sunLon: sunResp.result.longitude,
      });
    }
    if (moonResp.type === 'getMoonPosition') {
      useMapStore.setState({
        moonLat: moonResp.result.latitude,
        moonLon: moonResp.result.longitude,
      });
    }
  } catch { /* ignore */ }
}
