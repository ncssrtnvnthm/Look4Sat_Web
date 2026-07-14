import { create } from 'zustand';
import type { OrbitalPass, OrbitalPos, OrbitalData, SunPosition, MoonPosition, SatRadio } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds, getRadiosWithId } from '../../data/database';
import { getPosition, getSunPosition, getMoonPosition, calculatePasses } from '../../domain/wasmBridge';

interface RadarState {
  currentPass: OrbitalPass | null;
  currentTime: string;
  isTimeAos: boolean;
  isUtc: boolean;
  orientationValues: [number, number];
  orbitalPos: OrbitalPos | null;
  satTrack: OrbitalPos[];
  shouldShowSweep: boolean;
  shouldUseCompass: boolean;
  sunPosition: SunPosition | null;
  moonPosition: MoonPosition | null;
  _orbitalDataJson: string | null;
  _upcomingPasses: OrbitalPass[];
  _radios: SatRadio[];
  _satellites: OrbitalData[];
  _satIndex: number;
  _ticking: boolean;
  _lastSunMoonUpdate: number;

  startRadar: () => void;
  stopRadar: () => void;
  toggleSweep: () => void;
  toggleCompass: () => void;
  selectSatellite: (index: number) => void;
}

function formatTimer(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Calculate real passes for one satellite using the SGP4 bridge. */
async function fetchPasses(
  orbitalDataJson: string,
  lat: number, lon: number, alt: number,
): Promise<OrbitalPass[]> {
  const settings = useSettingsStore.getState();
  const now = getAdjustedTime();
  const hoursAhead = settings.passesSettings.hoursAhead || 12;
  const minElevation = settings.passesSettings.minElevation || 10;
  const endTime = now + hoursAhead * 3600000;

  const resp = await calculatePasses(
    orbitalDataJson, lat, lon, alt,
    now, endTime, minElevation,
  );
  if (resp.type === 'calculatePasses') {
    return resp.result.map((wp) => ({
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
    }));
  }
  return [];
}

export const useRadarStore = create<RadarState>()((set, get) => ({
  currentPass: null,
  currentTime: '00:00:00',
  isTimeAos: true,
  isUtc: false,
  orientationValues: [0, 0],
  orbitalPos: null,
  satTrack: [],
  shouldShowSweep: true,
  shouldUseCompass: false,
  sunPosition: null,
  moonPosition: null,
  _orbitalDataJson: null,
  _upcomingPasses: [],
  _radios: [],
  _satellites: [],
  _satIndex: 0,
  _ticking: false,
  _lastSunMoonUpdate: 0,

  startRadar: () => {
    const { _ticking } = get();
    if (_ticking) return; // already running
    set({ _ticking: true });

    const settings = useSettingsStore.getState();
    set({
      isUtc: settings.otherSettings.stateOfUtc,
      shouldShowSweep: settings.otherSettings.stateOfSweep,
      shouldUseCompass: settings.otherSettings.stateOfSensors,
    });

    // Load all selected satellites
    const selectedIds = useSelectedStore.getState().selectedIds;
    if (selectedIds.length > 0) {
      getEntriesWithIds(selectedIds).then(async (entries) => {
        if (entries.length > 0 && get()._ticking) {
          const startIdx = Math.min(useSelectedStore.getState().viewedSatIndex, entries.length - 1);
          set({ _satellites: entries, _satIndex: startIdx });
          await selectAndLoadSat(entries[startIdx]);
        }
      });
    }

    // Compass
    if (settings.otherSettings.stateOfSensors && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    // Start the tick loop (self-scheduling, no race conditions)
    scheduleTick();
  },

  stopRadar: () => {
    set({ _ticking: false });
    window.removeEventListener('deviceorientation', handleOrientation);
  },

  toggleSweep: () => set((s) => ({ shouldShowSweep: !s.shouldShowSweep })),
  toggleCompass: () => {
    const next = !get().shouldUseCompass;
    set({ shouldUseCompass: next });
    if (next && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation);
    } else {
      window.removeEventListener('deviceorientation', handleOrientation);
    }
  },

  selectSatellite: async (index: number) => {
    const satellites = get()._satellites;
    if (index < 0 || index >= satellites.length) return;
    useSelectedStore.getState().setViewedSatIndex(index);
    set({ _satIndex: index, orbitalPos: null, satTrack: [], currentPass: null });
    await selectAndLoadSat(satellites[index]);
  },
}));

/** Compute satellite track positions from AOS to LOS at 15-second intervals.
 *  Ported from Android SatelliteRepo.getTrack(). */
async function computeRadarTrack(
  orbitalDataJson: string,
  lat: number, lon: number, alt: number,
  aosTime: number, losTime: number,
) {
  const track: OrbitalPos[] = [];
  const stepMs = 15000;
  for (let t = aosTime; t <= losTime; t += stepMs) {
    try {
      const resp = await getPosition(orbitalDataJson, lat, lon, alt, t);
      if (resp.type === 'getPosition' && resp.result) {
        track.push({
          azimuth: resp.result.azimuth,
          elevation: resp.result.elevation,
          latitude: resp.result.latitude,
          longitude: resp.result.longitude,
          altitude: resp.result.altitude,
          distance: resp.result.distance,
          distanceRate: resp.result.distanceRate,
          theta: resp.result.theta,
          time: t,
          phase: resp.result.phase,
          eclipseDepth: resp.result.eclipseDepth,
          eclipsed: resp.result.eclipsed,
          aboveHorizon: resp.result.aboveHorizon,
        });
      }
    } catch { /* skip */ }
  }
  useRadarStore.setState({ satTrack: track });
}

/** Load passes and radios for a satellite, then start ticking. */
async function selectAndLoadSat(sat: OrbitalData) {
  const orbitalDataJson = JSON.stringify(sat);
  const { latitude, longitude, altitude } = useSettingsStore.getState().stationPosition;
  const [passes, radios] = await Promise.all([
    fetchPasses(orbitalDataJson, latitude, longitude, altitude),
    getRadiosWithId(sat.catnum),
  ]);
  useRadarStore.setState({
    _orbitalDataJson: orbitalDataJson,
    _upcomingPasses: passes,
    _radios: radios,
    currentPass: passes[0] || null,
    orbitalPos: null,
    satTrack: [],
  });
}

// ── Self-scheduling tick loop (avoids setInterval race conditions) ──

let tickTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTick() {
  tickTimer = setTimeout(() => runTick(), 1000);
}

async function runTick() {
  const state = get();
  if (!state._ticking) return;

  const { currentPass, _orbitalDataJson } = state;
  const now = getAdjustedTime();
  const settings = useSettingsStore.getState();
  const { latitude, longitude, altitude } = settings.stationPosition;

  // If no pass yet, wait
  if (!currentPass || !_orbitalDataJson) {
    scheduleTick();
    return;
  }

  let { aosTime, losTime } = currentPass;

  // If current pass ended, advance to next real pass or refetch
  if (now > losTime) {
    let upcoming = state._upcomingPasses;
    // Remove expired passes
    while (upcoming.length > 0 && upcoming[0].losTime <= now) {
      upcoming = upcoming.slice(1);
    }
    // Refetch if running low
    if (upcoming.length < 2 && _orbitalDataJson) {
      const { latitude, longitude, altitude } = settings.stationPosition;
      const fresh = await fetchPasses(_orbitalDataJson, latitude, longitude, altitude);
      // Merge: keep fresh passes that start after now
      upcoming = fresh.filter((p) => p.aosTime > now);
    }
    const nextPass = upcoming[0] || null;
    useRadarStore.setState({
      currentPass: nextPass,
      _upcomingPasses: upcoming,
      currentTime: nextPass ? formatTimer(nextPass.aosTime - now) : '--:--:--',
      isTimeAos: true,
      orbitalPos: null,
      satTrack: [],
    });
    scheduleTick();
    return;
  }

  // Before AOS — countdown
  if (now < aosTime) {
    useRadarStore.setState({
      currentTime: formatTimer(aosTime - now),
      isTimeAos: true,
    });
    scheduleTick();
    return;
  }

  // In pass — get live position
  try {
    const response = await getPosition(_orbitalDataJson, latitude, longitude, altitude, now);
    if (response.type === 'getPosition' && response.result) {
      const pos = response.result;

      // Compute track on first tick of the pass (matches Android loadPassData)
      if (state.satTrack.length === 0) {
        computeRadarTrack(_orbitalDataJson, latitude, longitude, altitude, aosTime, losTime);
      }

      useRadarStore.setState({
        currentTime: formatTimer(losTime - now),
        isTimeAos: false,
        orbitalPos: {
          azimuth: pos.azimuth,
          elevation: pos.elevation,
          latitude: pos.latitude,
          longitude: pos.longitude,
          altitude: pos.altitude,
          distance: pos.distance,
          distanceRate: pos.distanceRate,
          theta: pos.theta,
          time: now,
          phase: pos.phase,
          eclipseDepth: pos.eclipseDepth,
          eclipsed: pos.eclipsed,
          aboveHorizon: pos.aboveHorizon,
        },
      });
    }
  } catch (err) {
    console.warn('[radar] position fetch failed:', err);
  }

  // Sun/moon update every 60s
  if (now - state._lastSunMoonUpdate > 60000) {
    useRadarStore.setState({ _lastSunMoonUpdate: now });
    try {
      const [sunResp, moonResp] = await Promise.all([
        getSunPosition(latitude, longitude, now),
        getMoonPosition(latitude, longitude, now),
      ]);
      const updates: Partial<RadarState> = {};
      if (sunResp.type === 'getSunPosition') updates.sunPosition = sunResp.result;
      if (moonResp.type === 'getMoonPosition') updates.moonPosition = moonResp.result;
      if (Object.keys(updates).length > 0) useRadarStore.setState(updates);
    } catch { /* ignore */ }
  }

  scheduleTick();
}

// ── Helpers ──

function get(): RadarState {
  return useRadarStore.getState();
}

function handleOrientation(e: DeviceOrientationEvent) {
  const alpha = e.webkitCompassHeading ?? e.alpha ?? 0;
  useRadarStore.setState({ orientationValues: [alpha, 0] });
}
