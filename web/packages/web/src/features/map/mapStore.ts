import { create } from 'zustand';
import type { GeoPos, OrbitalData } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds } from '../../data/database';
import { getPosition, getSunPosition, getMoonPosition, getTrack } from '../../domain/wasmBridge';

interface MapState {
  selectedSat: OrbitalData | null;
  /** Ground track segments (split at dateline). Each segment is [lat, lng][] */
  trackSegments: [number, number][][];
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
  _lastSunMoonUpdate: number;

  initMap: () => Promise<void>;
  startTicking: () => void;
  stopTicking: () => void;
  selectPrev: () => void;
  selectNext: () => void;
  selectSatellite: (index: number) => void;
}

export const useMapStore = create<MapState>()((set, get) => ({
  selectedSat: null,
  trackSegments: [],
  allSatellites: [],
  sunLat: NaN,
  sunLon: NaN,
  moonLat: NaN,
  moonLon: NaN,
  selectedIndex: 0,
  satLat: null,
  satLon: null,
  satAlt: null,
  _ticking: false,
  _lastSunMoonUpdate: 0,

  initMap: async () => {
    const settings = useSettingsStore.getState();
    const selectedIds = useSelectedStore.getState().selectedIds;

    let allSatellites: OrbitalData[] = [];
    if (selectedIds.length > 0) {
      allSatellites = await getEntriesWithIds(selectedIds);
    }

    set({
      allSatellites,
      selectedSat: allSatellites[0] || null,
      selectedIndex: 0,
    });

    // Start at the shared viewed index if valid, matching by catalog number
    // (viewedSatIndex indexes into selectedIds; entries may be missing ids).
    // Skip if the user already switched satellites while initMap was loading (m10).
    if (allSatellites.length > 0 && !mapSelectionChanged) {
      const viewedId = selectedIds[Math.min(useSelectedStore.getState().viewedSatIndex, selectedIds.length - 1)];
      const sharedIdx = Math.max(0, allSatellites.findIndex((e) => e.catnum === viewedId));
      set({ selectedIndex: sharedIdx, selectedSat: allSatellites[sharedIdx] });
      computeTrack(allSatellites[sharedIdx], settings.stationPosition);
    }

    // Fetch initial sun/moon positions
    updateSunMoon();
  },

  startTicking: () => {
    if (get()._ticking) return;
    set({ _ticking: true });
    mapTickToken++; // invalidate any loop left over from a previous mount
    scheduleMapTick();
  },

  stopTicking: () => {
    set({ _ticking: false });
    mapTickToken++;
  },

  selectPrev: () => {
    mapSelectionChanged = true;
    const { allSatellites, selectedIndex } = get();
    if (allSatellites.length === 0) return;
    const idx = (selectedIndex - 1 + allSatellites.length) % allSatellites.length;
    const sat = allSatellites[idx];
    set({ selectedIndex: idx, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(idx);
    computeTrack(sat, useSettingsStore.getState().stationPosition);
  },

  selectNext: () => {
    mapSelectionChanged = true;
    const { allSatellites, selectedIndex } = get();
    if (allSatellites.length === 0) return;
    const idx = (selectedIndex + 1) % allSatellites.length;
    const sat = allSatellites[idx];
    set({ selectedIndex: idx, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(idx);
    computeTrack(sat, useSettingsStore.getState().stationPosition);
  },

  selectSatellite: (index: number) => {
    mapSelectionChanged = true;
    const { allSatellites } = get();
    if (index < 0 || index >= allSatellites.length) return;
    const sat = allSatellites[index];
    set({ selectedIndex: index, selectedSat: sat });
    useSelectedStore.getState().setViewedSatIndex(index);
    computeTrack(sat, useSettingsStore.getState().stationPosition);
  },
}));

// Guards: monotonic token drops ticks from a previous loop (same pattern as
// radarStore); flag prevents initMap from clobbering an in-flight selection.
let mapTickToken = 0;
let mapSelectionChanged = false;

function scheduleMapTick() {
  const token = mapTickToken;
  setTimeout(() => {
    if (token === mapTickToken) runMapTick();
  }, 1000);
}

async function runMapTick() {
  const state = useMapStore.getState();
  if (!state._ticking) return;
  const token = mapTickToken;

  const { selectedSat } = state;
  const stationPosition = useSettingsStore.getState().stationPosition;
  if (selectedSat && (stationPosition.latitude !== 0 || stationPosition.longitude !== 0)) {
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
  if (Date.now() - state._lastSunMoonUpdate > 60000) {
    useMapStore.setState({ _lastSunMoonUpdate: Date.now() });
    if (token !== mapTickToken) return;
    updateSunMoon();
  }

  scheduleMapTick();
}

// Guards against out-of-order track results when switching satellites quickly.
let trackToken = 0;

/**
 * Compute ground track for the selected satellite, ported from
 * Android MapViewModel.getSatTrack().
 *
 * The bridge computes the samples in one call (batched), then the
 * result is split into segments at ±180° longitude crossings.
 */
async function computeTrack(sat: OrbitalData, pos: GeoPos, attempt = 0) {
  // Don't compute if position is not set
  if (pos.latitude === 0 && pos.longitude === 0) return;
  const token = ++trackToken;

  const orbitalDataJson = JSON.stringify(sat);
  const now = getAdjustedTime();
  const durationMs = sat.orbitalPeriod * 2.4 * 60000;
  const endTime = now + durationMs;
  const stepMs = 15000; // 15-second steps matching Android

  const resp = await getTrack(orbitalDataJson, pos.latitude, pos.longitude, pos.altitude, now, endTime, stepMs);
  if (token !== trackToken) return; // superseded by a newer selection

  if (resp.type !== 'getTrack') {
    // Bridge not loaded yet — retry a few times if still the current satellite
    if (attempt < 5) {
      setTimeout(() => {
        if (trackToken === token) computeTrack(sat, pos, attempt + 1);
      }, 2000);
    }
    return;
  }

  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [];
  let prevLon: number | null = null;

  for (const p of resp.result) {
    let lon = p.longitude;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    const lat = p.latitude;

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
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  if (token !== trackToken) return;
  useMapStore.setState({ trackSegments: segments });
}

async function updateSunMoon() {
  try {
    const { latitude, longitude } = useSettingsStore.getState().stationPosition;
    const now = getAdjustedTime();
    const [sunResp, moonResp] = await Promise.all([
      getSunPosition(latitude, longitude, now),
      getMoonPosition(latitude, longitude, now),
    ]);
    const updates: Partial<MapState> = {};
    if (sunResp.type === 'getSunPosition') {
      updates.sunLat = sunResp.result.latitude;
      updates.sunLon = sunResp.result.longitude;
    }
    if (moonResp.type === 'getMoonPosition') {
      updates.moonLat = moonResp.result.latitude;
      updates.moonLon = moonResp.result.longitude;
    }
    if (Object.keys(updates).length > 0) useMapStore.setState(updates);
  } catch { /* ignore */ }
}
