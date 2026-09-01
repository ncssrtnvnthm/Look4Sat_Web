import { create } from 'zustand';
import type { OrbitalPass, OrbitalPos, OrbitalData, SunPosition, MoonPosition, SatRadio } from '../../domain/types';
import { useSettingsStore, useSelectedStore, getAdjustedTime } from '../../data/stores';
import { getEntriesWithIds, getRadiosWithId } from '../../data/database';
import { getPosition, getSunPosition, getMoonPosition, calculatePasses } from '../../domain/wasmBridge';
import { formatTimer } from '../../lib/time';
import { quaternionToHeading, computeMagDeclination } from '../../lib/compass';

interface RadarState {
  currentPass: OrbitalPass | null;
  currentTime: string;
  isTimeAos: boolean;
  orientationValues: [number, number];
  orbitalPos: OrbitalPos | null;
  satTrack: OrbitalPos[];
  shouldShowSweep: boolean;
  shouldUseCompass: boolean;
  /** User-facing explanation when the compass can't run (insecure context, permission, no sensor). */
  compassMessage: string | null;
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

/** Calculate real passes for one satellite using the SGP4 bridge. */
async function fetchPasses(
  orbitalDataJson: string,
  lat: number, lon: number, alt: number,
): Promise<OrbitalPass[]> {
  const settings = useSettingsStore.getState();
  const now = getAdjustedTime();
  const hoursAhead = settings.passesSettings.hoursAhead;
  const minElevation = settings.passesSettings.minElevation;
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
  currentTime: '--:--:--',
  isTimeAos: true,
  orientationValues: [0, 0],
  orbitalPos: null,
  satTrack: [],
  shouldShowSweep: true,
  shouldUseCompass: false,
  compassMessage: null,
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

    // Compass — start modern sensor or legacy listener.
    // On iOS (requestPermission API present), sensor access can only be granted
    // from a user gesture, so we don't auto-start here — the button tap enables it.
    const needsUserGesture =
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === 'function';
    if (settings.otherSettings.stateOfSensors) {
      if (needsUserGesture) {
        set({ shouldUseCompass: false });
        setCompassMessage('Tap the "Compass" button to enable the compass (iOS requires a tap to grant sensor access).');
      } else {
        startCompassSensor();
      }
    }

    // Start the tick loop (self-scheduling, no race conditions)
    scheduleTick();
  },

  stopRadar: () => {
    set({ _ticking: false });
    stopCompassSensor();
  },

  toggleSweep: () => {
    const next = !get().shouldShowSweep;
    set({ shouldShowSweep: next });
    useSettingsStore.getState().updateOtherSettings((s) => ({ ...s, stateOfSweep: next }));
  },
  toggleCompass: async () => {
    const next = !get().shouldUseCompass;
    if (next) {
      // iOS 13-16: requestPermission() MUST be called directly from the user-gesture handler
      let granted = true;
      const DeviceOrientation = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      } | undefined;
      if (typeof DeviceOrientation?.requestPermission === 'function') {
        try {
          const result = await DeviceOrientation.requestPermission();
          granted = result === 'granted';
        } catch {
          granted = false;
        }
      }
      if (granted) {
        startCompassSensor();
        setCompassMessage(null);
      } else {
        setCompassMessage('Compass permission denied. Enable Motion & Orientation access for this site in iOS Settings.');
      }
      set({ shouldUseCompass: granted });
      if (granted) {
        useSettingsStore.getState().updateOtherSettings((s) => ({ ...s, stateOfSensors: true }));
      }
    } else {
      set({ shouldUseCompass: false });
      stopCompassSensor();
      setCompassMessage(null);
      useSettingsStore.getState().updateOtherSettings((s) => ({ ...s, stateOfSensors: false }));
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

function scheduleTick() {
  setTimeout(() => runTick(), 1000);
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

function setCompassMessage(message: string | null) {
  useRadarStore.setState({ compassMessage: message });
}

// ── Compass sensor system ──

let sensor: AbsoluteOrientationSensor | null = null;
let sensorActive = false;

function startCompassSensor() {
  if (sensorActive) return;
  sensorActive = true;

  if (!window.isSecureContext) {
    // Sensor APIs AND legacy deviceorientation both require HTTPS on modern browsers.
    // Don't start anything — avoid pointless deprecated-API usage that can't work.
    console.warn('[compass] Requires a secure context (HTTPS). Compass unavailable on HTTP.');
    setCompassMessage('Compass requires a secure context (HTTPS). Open the site over HTTPS to use it.');
    useRadarStore.setState({ shouldUseCompass: false });
    sensorActive = false;
    return;
  }

  // Try modern Sensor API first
  if (typeof AbsoluteOrientationSensor !== 'undefined') {
    // Chrome requires permission for accelerometer/gyroscope/magnetometer
    const requestSensor = () => {
      try {
        sensor = new AbsoluteOrientationSensor({ frequency: 30 });
        sensor.addEventListener('reading', () => {
          if (!sensor?.quaternion) return;
          const q = sensor.quaternion;
          const heading = quaternionToHeading(q[0], q[1], q[2], q[3]);
          useRadarStore.setState({ orientationValues: [heading, 0] });
        });
        sensor.addEventListener('error', () => {
          stopCompassSensor();
          startLegacyCompass();
        });
        sensor.start();
      } catch (e) {
        console.warn('[compass] AbsoluteOrientationSensor failed to start:', e);
        stopCompassSensor();
        startLegacyCompass();
      }
    };

    // Request sensor permissions if the Permissions API supports them
    const names = ['accelerometer', 'gyroscope', 'magnetometer'] as const;
    const queryPermissions = names.map(
      (name) => (navigator as any).permissions?.query?.({ name }).catch(() => null),
    );
    Promise.all(queryPermissions).then((results) => {
      const allGranted = results.every((r) => !r || r.state === 'granted');
      if (allGranted) {
        requestSensor();
      } else if ((navigator as any).permissions) {
        // Ask for each pending permission, then start
        Promise.all(
          results.map((r) => {
            if (!r || r.state === 'granted' || r.state === 'denied') return Promise.resolve(r);
            return r.request?.() ?? Promise.resolve(r);
          }),
        ).finally(() => requestSensor());
      } else {
        requestSensor();
      }
    });
    return;
  }

  // Fall back to legacy DeviceOrientationEvent
  startLegacyCompass();
}

function stopCompassSensor() {
  sensorActive = false;
  if (sensor) {
    try { sensor.stop(); } catch { /* noop */ }
    sensor = null;
  }
  window.removeEventListener('deviceorientation', handleOrientation);
  window.removeEventListener('deviceorientationabsolute', handleOrientation as any);
}

function startLegacyCompass() {
  if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('deviceorientationabsolute', handleOrientation as any);
    console.log('[compass] Using legacy deviceorientation events');
  } else {
    console.warn('[compass] No orientation API available on this device.');
    setCompassMessage('No orientation sensor available on this device.');
    useRadarStore.setState({ shouldUseCompass: false });
  }
}

// ── Legacy deviceorientation handler (fallback for older browsers) ──

function handleOrientation(e: DeviceOrientationEvent) {
  let heading: number;
  if (e.webkitCompassHeading != null) {
    heading = e.webkitCompassHeading;
  } else if (e.alpha != null) {
    heading = e.absolute ? e.alpha + getMagDeclination() : e.alpha;
  } else {
    return;
  }
  useRadarStore.setState({ orientationValues: [heading % 360, 0] });
}

// ── Magnetic declination (cached; math lives in lib/compass.ts) ──

let _magDeclination: number | null = null;
let _magDeclinationPos: { lat: number; lon: number } | null = null;

function getMagDeclination(): number {
  const pos = useSettingsStore.getState().stationPosition;
  if (
    _magDeclination != null &&
    _magDeclinationPos?.lat === pos.latitude &&
    _magDeclinationPos?.lon === pos.longitude
  ) {
    return _magDeclination;
  }
  _magDeclination = computeMagDeclination(pos.latitude, pos.longitude);
  _magDeclinationPos = { lat: pos.latitude, lon: pos.longitude };
  return _magDeclination;
}
