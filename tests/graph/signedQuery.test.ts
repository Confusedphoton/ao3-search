import { describe, expect, it } from 'vitest';
import { signEdgesForNegativeSeeds } from '@/src/graph/signedQuery';

describe('signEdgesForNegativeSeeds', () => {
  it('negates edges incident to negative seed nodes', () => {
    // Line 0 — 1 — 2
    const offsets = [0, 1, 3, 4];
    const neighbors = [1, 0, 2, 1];
    const edgeWeights = [0.5, 0.5, 0.5, 0.5];

    const signed = signEdgesForNegativeSeeds(offsets, neighbors, edgeWeights, [2]);

    expect(signed[0]).toBe(0.5);
    expect(signed[1]).toBe(0.5);
    expect(signed[2]).toBe(-0.5);
    expect(signed[3]).toBe(-0.5);
  });

  it('returns the original weights when there are no negative seeds', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [0.6, 0.4];

    const signed = signEdgesForNegativeSeeds(offsets, neighbors, edgeWeights, []);
    expect(signed).toBe(edgeWeights);
  });
});
