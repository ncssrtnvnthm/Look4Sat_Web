import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from '../presentation/MainLayout';
import { SatellitesPage } from '../features/satellites/SatellitesPage';
import { PassesPage } from '../features/passes/PassesPage';
import { RadarPage } from '../features/radar/RadarPage';
import { MapPage } from '../features/map/MapPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { useSettingsStore } from '../data/stores';

function ThemeProvider() {
  const otherSettings = useSettingsStore((s) => s.otherSettings);

  useEffect(() => {
    const root = document.documentElement;
    if (otherSettings.stateOfLightTheme) {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
  }, [otherSettings.stateOfLightTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (otherSettings.stateOfNightMode) {
      root.setAttribute('data-night-mode', 'true');
    } else {
      root.removeAttribute('data-night-mode');
    }
  }, [otherSettings.stateOfNightMode]);

  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider />
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="/passes" replace />} />
          <Route path="satellites" element={<SatellitesPage />} />
          <Route path="passes" element={<PassesPage />} />
          <Route path="radar" element={<RadarPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
