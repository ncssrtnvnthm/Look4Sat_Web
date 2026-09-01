// ── TypeScript types matching WasmBridge.kt serializable types ──

export interface WasmOrbitalPos {
  azimuth: number;
  elevation: number;
  latitude: number;
  longitude: number;
  altitude: number;
  distance: number;
  distanceRate: number;
  theta: number;
  time: number;
  phase: number;
  eclipseDepth: number;
  eclipsed: boolean;
  aboveHorizon: boolean;
  orbitalVelocity: number;
  downlinkFreq: number;
  uplinkFreq: number;
}

export interface WasmSunPosition {
  azimuth: number;
  elevation: number;
  latitude: number;
  longitude: number;
}

export interface WasmMoonPosition {
  azimuth: number;
  elevation: number;
  latitude: number;
  longitude: number;
}

export interface WasmSunTimes {
  sunrise: number;
  sunset: number;
}

export interface WasmPass {
  aosTime: number;
  aosAzimuth: number;
  losTime: number;
  losAzimuth: number;
  altitude: number;
  maxElevation: number;
  catNum: number;
  name: string;
  isDeepSpace: boolean;
  hasDecayed: boolean;
}

export interface WasmTrackPoint {
  latitude: number;
  longitude: number;
}

