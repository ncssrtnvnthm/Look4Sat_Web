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

    // Compass — start modern sensor or legacy listener
    if (settings.otherSettings.stateOfSensors) {
      startCompassSensor();
    }

    // Start the tick loop (self-scheduling, no race conditions)
    scheduleTick();
  },

  stopRadar: () => {
    set({ _ticking: false });
    stopCompassSensor();
  },

  toggleSweep: () => set((s) => ({ shouldShowSweep: !s.shouldShowSweep })),
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
      }
      set({ shouldUseCompass: granted });
    } else {
      set({ shouldUseCompass: false });
      stopCompassSensor();
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

// ── Compass sensor system ──

let sensor: AbsoluteOrientationSensor | null = null;
let sensorActive = false;

function startCompassSensor() {
  if (sensorActive) return;
  sensorActive = true;

  // Try modern Sensor API first
  if (typeof AbsoluteOrientationSensor !== 'undefined') {
    try {
      sensor = new AbsoluteOrientationSensor({ frequency: 30 });
      sensor.addEventListener('reading', () => {
        if (!sensor?.quaternion) return;
        const q = sensor.quaternion;
        // Convert quaternion to Euler angles (yaw = compass heading from true north)
        const heading = quaternionToHeading(q[0], q[1], q[2], q[3]);
        useRadarStore.setState({ orientationValues: [heading, 0] });
      });
      sensor.addEventListener('error', () => {
        // Fall back to legacy API
        stopCompassSensor();
        startLegacyCompass();
      });
      sensor.start();
      return;
    } catch {
      // Sensor API not available, fall back
    }
  }

  // Fall back to legacy DeviceOrientationEvent
  startLegacyCompass();
}

function stopCompassSensor() {
  sensorActive = false;
  if (sensor) {
    sensor.stop();
    sensor = null;
  }
  window.removeEventListener('deviceorientation', handleOrientation);
  window.removeEventListener('deviceorientationabsolute', handleOrientation as any);
}

function startLegacyCompass() {
  if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('deviceorientationabsolute', handleOrientation as any);
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

// ── Magnetic declination ──

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

function computeMagDeclination(lat: number, lon: number): number {
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  // WMM2020 Gauss coefficients (nT), truncated to n=3
  const g10 = -29404.5, g11 = -1450.7, h11 = 4652.9;
  const g20 = -2500.0, g21 = 2982.0, h21 = -2991.0, g22 = 1676.8, h22 = -734.8;
  const g30 = 1363.9, g31 = -2381.0, h31 = -82.3, g32 = 1236.2, h32 = 241.8, g33 = 525.7, h33 = -542.9;

  const p10 = sinPhi, dp10 = cosPhi;
  const p11 = cosPhi, dp11 = -sinPhi;
  const p20 = 1.5 * sinPhi * sinPhi - 0.5, dp20 = 3.0 * sinPhi * cosPhi;
  const p21 = 3.0 * sinPhi * cosPhi, dp21 = 3.0 * (cosPhi * cosPhi - sinPhi * sinPhi);
  const p22 = 3.0 * cosPhi * cosPhi, dp22 = -6.0 * sinPhi * cosPhi;
  const p30 = 2.5 * sinPhi * sinPhi * sinPhi - 1.5 * sinPhi, dp30 = (7.5 * sinPhi * sinPhi - 1.5) * cosPhi;
  const p31 = 1.5 * (5.0 * sinPhi * sinPhi - 1.0) * cosPhi;
  const dp31 = 1.5 * ((10.0 * sinPhi * cosPhi * cosPhi) - (5.0 * sinPhi * sinPhi - 1.0) * sinPhi);
  const p32 = 15.0 * sinPhi * cosPhi * cosPhi, dp32 = 15.0 * (cosPhi * cosPhi * cosPhi - 2.0 * sinPhi * sinPhi * cosPhi);
  const p33 = 15.0 * cosPhi * cosPhi * cosPhi, dp33 = -45.0 * sinPhi * cosPhi * cosPhi;

  const x = -dp10 * g10 - dp11 * (g11 * Math.cos(lambda) + h11 * Math.sin(lambda))
    - dp20 * g20 - dp21 * (g21 * Math.cos(lambda) + h21 * Math.sin(lambda))
    - dp22 * (g22 * Math.cos(2 * lambda) + h22 * Math.sin(2 * lambda))
    - dp30 * g30 - dp31 * (g31 * Math.cos(lambda) + h31 * Math.sin(lambda))
    - dp32 * (g32 * Math.cos(2 * lambda) + h32 * Math.sin(2 * lambda))
    - dp33 * (g33 * Math.cos(3 * lambda) + h33 * Math.sin(3 * lambda));

  const y = (1.0 / cosPhi) * (
    p11 * (g11 * Math.sin(lambda) - h11 * Math.cos(lambda))
    + p21 * (g21 * Math.sin(lambda) - h21 * Math.cos(lambda))
    + p22 * (g22 * Math.sin(2 * lambda) - h22 * Math.cos(2 * lambda))
    + p31 * (g31 * Math.sin(lambda) - h31 * Math.cos(lambda))
    + p32 * (g32 * Math.sin(2 * lambda) - h32 * Math.cos(2 * lambda))
    + p33 * (g33 * Math.sin(3 * lambda) - h33 * Math.cos(3 * lambda))
  );

  return Math.atan2(y, x) * 180 / Math.PI;
}

/** Convert quaternion [x, y, z, w] to yaw angle in degrees (0 = north, 90 = east). */
function quaternionToHeading(x: number, y: number, z: number, w: number): number {
  // Compute rotation matrix elements for the Z-X-Y convention (device orientation)
  // Yaw (psi) = atan2(2*(q0*q3 + q1*q2), 1 - 2*(q2^2 + q3^2))
  // where q0=w, q1=x, q2=y, q3=z
  const yaw = Math.atan2(
    2 * (w * z + x * y),
    1 - 2 * (y * y + z * z),
  );
  // Convert to degrees (0-360), negate to match compass convention
  let heading = (-yaw * 180) / Math.PI;
  heading = ((heading % 360) + 360) % 360;
  return heading;
}
