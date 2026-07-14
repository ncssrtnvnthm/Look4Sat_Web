import { useEffect } from 'react';
import { TopBar, SwipeableItem } from '../../presentation/Components';
import { useSatellitesStore, getFilteredItems } from './satellitesStore';
import styles from './SatellitesPage.module.css';

export function SatellitesPage() {
  const store = useSatellitesStore();
  const filteredItems = getFilteredItems(store);
  const selectedCount = store.itemsList.filter((i) => i.isSelected).length;

  useEffect(() => {
    store.loadSatellites();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = (key: string) => {
    const current = store.currentCategories;
    const next = current.includes(key)
      ? current.filter((c) => c !== key)
      : [...current, key];
    store.setCategories(next);
  };

  return (
    <div className={styles.page}>
      <TopBar
        title="Satellites"
        actions={
          <>
            <button className={styles.actionBtn} onClick={store.selectFiltered}>
              Select shown
            </button>
            <button className={styles.actionBtn} onClick={store.selectAll}>
              All
            </button>
            <button className={styles.actionBtn} onClick={store.unselectAll}>
              None
            </button>
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={store.saveSelection}
            >
              Save ({selectedCount})
            </button>
          </>
        }
      />

      {/* Search */}
      <div className={styles.searchBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search satellites..."
          value={store.searchQuery}
          onChange={(e) => store.setSearchQuery(e.target.value)}
        />
      </div>

      {/* Warning — shown only on first visit */}
      {store.shouldSeeWarning && (
        <div className={styles.warning}>
          <div className={styles.warningContent}>
            <span className={styles.warningTitle}>⚠️ Warning!</span>
            <p>
              There are over 9000 satellites listed in this app.
              It makes no sense to track them all at the same time.
            </p>
            <p>
              Always try to narrow down the list to only the ones
              you're interested in via search and types selector.
            </p>
          </div>
          <button className={styles.warningDismiss} onClick={store.dismissWarning}>
            ✕
          </button>
        </div>
      )}

      {/* Warning */}
      {store.shouldSeeWarning && (
        <div className={styles.warning}>
          <div className={styles.warningContent}>
            First time? Select satellites to track, then save. Use categories to filter by type.
          </div>
          <button className={styles.warningDismiss} onClick={store.dismissWarning}>
            ✕
          </button>
        </div>
      )}

            {/* Category filter chips */}
      <div className={styles.categoryBar}>
        {store.availableCategories.map(({ key, label }) => {
          const active = store.currentCategories.includes(key);
          return (
            <button
              key={key}
              className={`${styles.categoryChip} ${active ? styles.categoryChipActive : ''}`}
              onClick={() => toggleCategory(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {store.isLoading && (
        <div className={styles.loading}>Loading satellite data...</div>
      )}

      {/* List */}
      <div className={styles.list}>
        {filteredItems.map((item) => (
          <SwipeableItem
            key={item.catnum}
            onClick={() => store.selectSingle(item.catnum, !item.isSelected)}
          >
            <div className={styles.itemRow}>
              <input
                type="checkbox"
                checked={item.isSelected}
                onChange={() =>
                  store.selectSingle(item.catnum, !item.isSelected)
                }
                className={styles.checkbox}
              />
              <div className={styles.itemInfo}>
                <span className={styles.name}>{item.name}</span>
                <div className={styles.catTags}>
                  <a
                    href={`https://www.n2yo.com/satellite/?s=${item.catnum}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.catnum}
                  >
                    #{item.catnum}
                  </a>
                  {item.categories.slice(0, 2).map((cat) => (
                    <span key={cat} className={styles.catTag}>{cat}</span>
                  ))}
                </div>
              </div>
            </div>
          </SwipeableItem>
        ))}
        {!store.isLoading && filteredItems.length === 0 && (
          <div className={styles.empty}>
            {store.itemsList.length === 0
              ? 'No satellite data loaded. Go to Settings → Update from Celestrak.'
              : 'No satellites match the current filters.'}
          </div>
        )}
      </div>
    </div>
  );
}
