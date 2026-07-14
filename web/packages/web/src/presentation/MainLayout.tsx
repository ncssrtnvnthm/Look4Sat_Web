import { Outlet, NavLink } from 'react-router-dom';
import styles from './MainLayout.module.css';

const NAV_ITEMS = [
  { to: '/satellites', label: 'Satellites', icon: '🛰️' },
  { to: '/passes', label: 'Passes', icon: '⏱️' },
  { to: '/radar', label: 'Radar', icon: '📡' },
  { to: '/map', label: 'Map', icon: '🗺️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const;

export function MainLayout() {
  return (
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
  );
}
