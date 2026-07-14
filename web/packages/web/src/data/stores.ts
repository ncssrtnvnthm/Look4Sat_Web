import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  OtherSettings,
  PassesSettings,
  RCSettings,
  DataSourcesSettings,
  RadioControlSettings,
  GeoPos,
  DatabaseState,
} from '../domain/types';

// ── Default values mirroring Android defaults ──

const DEFAULT_OTHER: OtherSettings = {
  stateOfAutoUpdate: true,
  stateOfSensors: false,
  stateOfSweep: true,
  stateOfUtc: false,
  stateOfLightTheme: false,
  stateOfNightMode: false,
  shouldSeeWarning: true,
  shouldSeeWhatsNew: true,
  sstvMode: 'Auto',
  timeOffsetMinutes: 0,
};

const DEFAULT_PASSES: PassesSettings = {
  showDeepSpace: true,
  hoursAhead: 12,
  minElevation: 16,
  selectedModes: [],
};

const DEFAULT_RC: RCSettings = {
  rotatorState: false,
  rotatorAddress: '',
  rotatorPort: '4533',
  rotatorFormat: 'Hamlib',
  frequencyState: false,
  frequencyAddress: '',
  frequencyPort: '4533',
  frequencyFormat: 'Hamlib',
  bluetoothRotatorState: false,
  bluetoothRotatorFormat: 'Hamlib',
  bluetoothRotatorName: '',
  bluetoothRotatorAddress: '',
  bluetoothFrequencyState: false,
  bluetoothFrequencyFormat: 'Hamlib',
  bluetoothFrequencyAddress: '',
};

const DEFAULT_DATA_SOURCES: DataSourcesSettings = {
  useCustomTLE: false,
  useCustomTransceivers: false,
  tleUrl: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv',
  transceiversUrl: '/api/satnogs/api/transmitters/?format=json',
};

const DEFAULT_RADIO_CONTROL: RadioControlSettings = {
  enabled: false,
  radioModel: 'FT-817',
  txRadioAddress: '',
  rxRadioAddress: '',
  txRadioName: '',
  rxRadioName: '',
  baudRate: 9600,
};

const DEFAULT_POSITION: GeoPos = {
  latitude: 0,
  longitude: 0,
  altitude: 0,
};

const DEFAULT_DATABASE_STATE: DatabaseState = {
  numberOfRadios: 0,
  numberOfSatellites: 0,
  updateTimestamp: 0,
};

// ── Store interfaces ──

interface SelectedState {
  selectedIds: number[];
  selectedTypes: string[];
  /** Index of the satellite currently viewed on map/radar (shared between pages). */
  viewedSatIndex: number;
  setSelectedIds: (ids: number[]) => void;
  setSelectedTypes: (types: string[]) => void;
  setViewedSatIndex: (index: number) => void;
}

interface SettingsState {
  // Sub-states
  otherSettings: OtherSettings;
  passesSettings: PassesSettings;
  rcSettings: RCSettings;
  dataSourcesSettings: DataSourcesSettings;
  radioControlSettings: RadioControlSettings;
  stationPosition: GeoPos;
  databaseState: DatabaseState;
  appVersionName: string;

  // Actions
  updateOtherSettings: (transform: (s: OtherSettings) => OtherSettings) => void;
  setPassesSettings: (settings: PassesSettings) => void;
  updateRCSettings: (settings: RCSettings) => void;
  updateDataSourcesSettings: (settings: DataSourcesSettings) => void;
  updateRadioControlSettings: (settings: RadioControlSettings) => void;
  setStationPosition: (pos: GeoPos) => void;
  updateDatabaseState: (state: DatabaseState) => void;
}

// ── Stores ──

export const useSelectedStore = create<SelectedState>()(
  persist(
    (set) => ({
      selectedIds: [],
      selectedTypes: [],
      viewedSatIndex: 0,
      setSelectedIds: (ids) => set({ selectedIds: ids }),
      setSelectedTypes: (types) => set({ selectedTypes: types }),
      setViewedSatIndex: (index) => set({ viewedSatIndex: index }),
    }),
    { name: 'look4sat-selected' },
  ),
);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      otherSettings: DEFAULT_OTHER,
      passesSettings: DEFAULT_PASSES,
      rcSettings: DEFAULT_RC,
      dataSourcesSettings: DEFAULT_DATA_SOURCES,
      radioControlSettings: DEFAULT_RADIO_CONTROL,
      stationPosition: DEFAULT_POSITION,
      databaseState: DEFAULT_DATABASE_STATE,
      appVersionName: '4.4.3',

      updateOtherSettings: (transform) =>
        set((s) => ({ otherSettings: transform(s.otherSettings) })),
      setPassesSettings: (settings) => set({ passesSettings: settings }),
      updateRCSettings: (settings) => set({ rcSettings: settings }),
      updateDataSourcesSettings: (settings) => set({ dataSourcesSettings: settings }),
      updateRadioControlSettings: (settings) => set({ radioControlSettings: settings }),
      setStationPosition: (pos) => set({ stationPosition: pos }),
      updateDatabaseState: (state) => set({ databaseState: state }),
    }),
    { name: 'look4sat-settings' },
  ),
);

/** Get current time adjusted by the user's time offset setting (milliseconds). */
export function getAdjustedTime(): number {
  const offset = useSettingsStore.getState().otherSettings.timeOffsetMinutes ?? 0;
  return Date.now() + offset * 60000;
}
