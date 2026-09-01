import { describe, it, expect } from 'vitest';
import { noradUrl } from './noradUrl';

describe('noradUrl', () => {
  it('builds the N2YO lookup URL for a catalog number', () => {
    expect(noradUrl(25544)).toBe('https://www.n2yo.com/satellite/?s=25544');
  });
});
