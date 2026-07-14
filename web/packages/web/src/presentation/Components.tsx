import { ReactNode } from 'react';
import styles from './Components.module.css';

// ── Timer display (HH:MM:SS) ──

export function TimerRow({ time, isAos, label }: { time: string; isAos: boolean; label: string }) {
  return (
    <div className={styles.timerRow}>
      <span className={styles.timerLabel}>{label}</span>
      <span className={`${styles.timerValue} ${isAos ? styles.aos : styles.los}`}>
        {time}
      </span>
      <span className={styles.timerPhase}>{isAos ? 'AOS' : 'LOS'}</span>
    </div>
  );
}

// ── Icon card (icon + label + value) ──

export function IconCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.iconCard}>
      <span className={styles.iconCardIcon}>{icon}</span>
      <span className={styles.iconCardLabel}>{label}</span>
      <span className={styles.iconCardValue}>{value}</span>
    </div>
  );
}

// ── Top bar with title and optional action ──

export function TopBar({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.topBar}>
      <h2 className={styles.topBarTitle}>{title}</h2>
      {actions && <div className={styles.topBarActions}>{actions}</div>}
    </div>
  );
}

// ── Swipeable list item ──

export function SwipeableItem({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={styles.swipeableItem} onClick={onClick} role="button" tabIndex={0}>
      {children}
    </div>
  );
}

// ── Next pass row (used in radar footer) ──

export function NextPassRow({
  name,
  aosTime,
  maxElevation,
}: {
  name: string;
  aosTime: string;
  maxElevation: number;
}) {
  return (
    <div className={styles.nextPassRow}>
      <span className={styles.nextPassName}>{name}</span>
      <span className={styles.nextPassTime}>{aosTime}</span>
      <span className={styles.nextPassElev}>{maxElevation.toFixed(0)}°</span>
    </div>
  );
}
