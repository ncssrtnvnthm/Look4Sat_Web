// ── Core domain types mirroring Kotlin data classes ──
// These are the TypeScript equivalents of the KMP domain models.
// When the Wasm module is integrated, complex types will be bridged via JSON.

export interface GeoPos {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface OrbitalData {
  name: string;
  epoch: number;
  meanmo: number;
  eccn: number;
  incl: number;
  raan: number;
  argper: number;
  meanan: number;
  catnum: number;
  bstar: number;
  ndot: number;
  // Derived
  xincl: number;
  xnodeo: number;
  omegao: number;
  xmo: number;
  xno: number;
  orbitalPeriod: number;
  isDeepSpace: boolean;
}

export interface OrbitalPos {
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
}

export interface OrbitalPass {
  aosTime: number;
  aosAzimuth: number;
  losTime: number;
  losAzimuth: number;
  altitude: number;
  maxElevation: number;
  catNum: number;
  name: string;
  isDeepSpace: boolean;
  progress: number;
  hasDecayed: boolean;
}

export interface SatItem {
  catnum: number;
  name: string;
  isSelected: boolean;
  categories: string[];
}

export interface SatRadio {
  uuid: string;
  name: string;
  description: string;
  uplinkLow: number | null;
  uplinkHigh: number | null;
  downlinkLow: number | null;
  downlinkHigh: number | null;
  mode: string | null;
  ctcss: number | null;
  noradCatId: number;
}

// ── Settings models ──

export interface DatabaseState {
  numberOfRadios: number;
  numberOfSatellites: number;
  updateTimestamp: number;
}

export interface PassesSettings {
  showDeepSpace: boolean;
  hoursAhead: number;
  minElevation: number;
  selectedModes: string[];
}

export interface RCSettings {
  rotatorState: boolean;
  rotatorAddress: string;
  rotatorPort: string;
  rotatorFormat: string;
  frequencyState: boolean;
  frequencyAddress: string;
  frequencyPort: string;
  frequencyFormat: string;
  bluetoothRotatorState: boolean;
  bluetoothRotatorFormat: string;
  bluetoothRotatorName: string;
  bluetoothRotatorAddress: string;
  bluetoothFrequencyState: boolean;
  bluetoothFrequencyFormat: string;
  bluetoothFrequencyAddress: string;
}

export interface OtherSettings {
  stateOfAutoUpdate: boolean;
  stateOfSensors: boolean;
  stateOfSweep: boolean;
  stateOfUtc: boolean;
  stateOfLightTheme: boolean;
  stateOfNightMode: boolean;
  shouldSeeWarning: boolean;
  shouldSeeWhatsNew: boolean;
  sstvMode: string;
  /** Time offset in minutes. Negative = past, positive = future. 0 = real-time. */
  timeOffsetMinutes: number;
}

export interface DataSourcesSettings {
  useCustomTLE: boolean;
  useCustomTransceivers: boolean;
  tleUrl: string;
  transceiversUrl: string;
}

export interface RadioControlSettings {
  enabled: boolean;
  radioModel: string;
  txRadioAddress: string;
  rxRadioAddress: string;
  txRadioName: string;
  rxRadioName: string;
  baudRate: number;
}

// ── Celestial positions ──

export interface SunPosition {
  azimuth: number;
  elevation: number;
}

export interface MoonPosition {
  azimuth: number;
  elevation: number;
  phase: number;
}

// ── SSTV ──

export interface SstvFrame {
  imageData: ImageData | null;
  modeName: string;
}
