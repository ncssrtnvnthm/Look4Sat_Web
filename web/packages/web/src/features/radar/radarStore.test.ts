import { describe, it, expect } from 'vitest';
import { filterUpcomingPasses } from './radarStore';

describe('filterUpcomingPasses', () => {
  it('keeps passes still in the air and upcoming ones', () => {
    const now = 1000;
    const passes = [
      { aosTime: 500, losTime: 900 },   // ended
      { aosTime: 950, losTime: 1200 },  // in progress (aosTime < now < losTime)
      { aosTime: 1500, losTime: 2000 }, // upcoming
    ];
    const kept = filterUpcomingPasses(passes, now);
    expect(kept.map((p) => p.losTime)).toEqual([1200, 2000]);
  });

  it('keeps a pass the bridge reports as just starting (aosTime = now)', () => {
    // The bridge reports an in-progress pass with aosTime = now; a strict
    // `aosTime > now` filter would drop it (M1).
    const now = 1000;
    const kept = filterUpcomingPasses([{ aosTime: 1000, losTime: 1500 }], now);
    expect(kept).toHaveLength(1);
  });

  it('drops everything when the window is empty', () => {
    expect(filterUpcomingPasses([], 1000)).toEqual([]);
  });
});
