import { describe, expect, it } from 'vitest';
import { fuzzyTagMatch } from '@/src/search/fuzzyTagMatch';

describe('fuzzyTagMatch', () => {
  it('prefers exact and prefix matches', () => {
    const exact = fuzzyTagMatch('fluff', 'Fluff')!;
    const prefix = fuzzyTagMatch('har', 'Harry Potter - J. K. Rowling')!;
    const fuzzy = fuzzyTagMatch('hry', 'Harry Potter - J. K. Rowling')!;

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(fuzzy);
  });

  it('matches substrings', () => {
    expect(fuzzyTagMatch('potter', 'Harry Potter - J. K. Rowling')).not.toBeNull();
  });

  it('matches out-of-order characters as a subsequence', () => {
    expect(fuzzyTagMatch('hpjk', 'Harry Potter - J. K. Rowling')).not.toBeNull();
    expect(fuzzyTagMatch('xyz', 'Harry Potter - J. K. Rowling')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyTagMatch('FLUFF', 'fluff')).toBe(1_000);
  });
});
