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

export interface WasmPassList {
  passes: WasmPass[];
}

// ── Worker message types ──

export type WorkerRequest =
  | { id: number; type: 'getPosition'; orbitalDataJson: string; lat: number; lon: number; alt: number; timeMs: number }
  | { id: number; type: 'willBeSeen'; orbitalDataJson: string; lat: number; lon: number }
  | { id: number; type: 'getSunPosition'; lat: number; lon: number; timeMs: number }
  | { id: number; type: 'getMoonPosition'; lat: number; lon: number; timeMs: number }
  | { id: number; type: 'calculatePasses'; orbitalDataJson: string; lat: number; lon: number; alt: number; startTimeMs: number; endTimeMs: number; minElevation: number };

/** Request input — same as WorkerRequest but id is added by the bridge. */
export type WorkerRequestInput =
  | { type: 'getPosition'; orbitalDataJson: string; lat: number; lon: number; alt: number; timeMs: number }
  | { type: 'willBeSeen'; orbitalDataJson: string; lat: number; lon: number }
  | { type: 'getSunPosition'; lat: number; lon: number; timeMs: number }
  | { type: 'getMoonPosition'; lat: number; lon: number; timeMs: number }
  | { type: 'calculatePasses'; orbitalDataJson: string; lat: number; lon: number; alt: number; startTimeMs: number; endTimeMs: number; minElevation: number };

export type WorkerResponse =
  | { id: number; type: 'getPosition'; result: WasmOrbitalPos | null }
  | { id: number; type: 'willBeSeen'; result: boolean }
  | { id: number; type: 'getSunPosition'; result: WasmSunPosition }
  | { id: number; type: 'getMoonPosition'; result: WasmMoonPosition }
  | { id: number; type: 'calculatePasses'; result: WasmPass[] }
  | { id: number; type: 'error'; error: string };
