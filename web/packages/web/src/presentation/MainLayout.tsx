import { Outlet, NavLink, Link } from 'react-router-dom';
import { useSettingsStore } from '../data/stores';
import styles from './MainLayout.module.css';

const NAV_ITEMS = [
  { to: '/satellites', label: 'Satellites', icon: '🛰️' },
  { to: '/passes', label: 'Passes', icon: '⏱️' },
  { to: '/radar', label: 'Radar', icon: '📡' },
  { to: '/map', label: 'Map', icon: '🗺️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const;

export function MainLayout() {
  const satelliteCount = useSettingsStore((s) => s.databaseState.numberOfSatellites);
  const { latitude, longitude } = useSettingsStore((s) => s.stationPosition);
  const needsSetup = satelliteCount === 0 || (latitude === 0 && longitude === 0);

  return (
    <>
      {needsSetup && (
        <div className={styles.warning}>
          <span>
            {satelliteCount === 0 && (
              <>
                No satellite data loaded.{' '}
              </>
            )}
            {latitude === 0 && longitude === 0 && (
              <>
                Station position not set.{' '}
              </>
            )}
            Go to{' '}
            <Link to="/settings" className={styles.warningLink}>
              Settings
            </Link>{' '}
            to configure satellite data and station location.
          </span>
        </div>
      )}
      <div className={styles.layout}>
        <main className={styles.content}>
          <Outlet />
        </main>
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ''}`
              }
            >
              <span className={styles.icon}>{icon}</span>
              <span className={styles.label}>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}
