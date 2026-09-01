import { describe, it, expect } from 'vitest';
import { migrateSettings, useSettingsStore } from './stores';
import type { SettingsState } from './stores';

function currentState(): SettingsState {
  return useSettingsStore.getState();
}

describe('migrateSettings', () => {
  it('fills satelliteSources for settings saved before the field existed', () => {
    // Simulates localStorage persisted before satelliteSources was added.
    const old = { dataSourcesSettings: { transceiversUrl: 'https://old.example' } };
    const migrated = migrateSettings(old, currentState());
    expect(migrated.dataSourcesSettings.satelliteSources).toEqual([]);
    expect(migrated.dataSourcesSettings.transceiversUrl).toBe('https://old.example');
  });

  it('preserves a fully-populated modern payload', () => {
    const modern = {
      dataSourcesSettings: {
        transceiversUrl: 'https://x',
        satelliteSources: [{ name: 'A', url: 'https://a' }],
      },
    };
    const migrated = migrateSettings(modern, currentState());
    expect(migrated.dataSourcesSettings.satelliteSources).toEqual([{ name: 'A', url: 'https://a' }]);
  });

  it('fills missing otherSettings/passesSettings fields from defaults', () => {
    const old = { otherSettings: { stateOfUtc: true } as Partial<SettingsState['otherSettings']> };
    const migrated = migrateSettings(old, currentState());
    expect(migrated.otherSettings.stateOfUtc).toBe(true);
    expect(migrated.otherSettings.timeOffsetMinutes).toBe(0); // from defaults
    expect(migrated.otherSettings.shouldSeeWarning).toBe(true);
  });

  it('keeps store actions intact', () => {
    const migrated = migrateSettings(null, currentState());
    expect(typeof migrated.setStationPosition).toBe('function');
  });
});
