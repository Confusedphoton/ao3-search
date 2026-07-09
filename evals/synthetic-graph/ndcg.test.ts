import { describe, expect, it } from 'vitest';
import { dcgAtK, meanNdcgAtKs, ndcgAtK } from './ndcg';

describe('ndcg', () => {
  it('scores a perfect ranking as 1', () => {
    const gains = new Map([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    expect(ndcgAtK(['a', 'b', 'c'], gains, 3)).toBeCloseTo(1, 8);
  });

  it('penalizes inverted rankings', () => {
    const gains = new Map([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ]);
    const perfect = ndcgAtK(['a', 'b', 'c'], gains, 3);
    const inverted = ndcgAtK(['c', 'b', 'a'], gains, 3);
    expect(inverted).toBeLessThan(perfect);
    expect(inverted).toBeGreaterThan(0);
  });

  it('averages across a K sweep', () => {
    const gains = new Map([
      ['a', 1],
      ['b', 1],
    ]);
    const mean = meanNdcgAtKs(['a', 'b'], gains, [1, 2]);
    expect(mean).toBeCloseTo(1, 8);
  });

  it('computes discounted cumulative gain', () => {
    expect(dcgAtK([1, 1], 2)).toBeCloseTo(1 + 1 / Math.log2(3), 8);
  });
});
