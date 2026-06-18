import { describe, expect, it } from 'vitest';
import { runPPR } from '@/src/ppr/solver';

describe('runPPR', () => {
  it('concentrates authority on nodes connected to seeds', () => {
    // Triangle: 0 — 1 — 2, seed at 0
    const offsets = [0, 1, 2, 3];
    const neighbors = [1, 0, 2, 1];
    const edgeWeights = [1, 1, 1, 1];

    const result = runPPR({
      offsets,
      neighbors,
      edgeWeights,
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    expect(result.authority[0]).toBeGreaterThan(result.authority[2]);
    expect(result.authority[1]).toBeGreaterThan(0);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('returns zero authority when no seeds are provided', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [1, 1];

    const result = runPPR({
      offsets,
      neighbors,
      edgeWeights,
      seedIndices: [],
    });

    expect(result.authority.every((v) => v === 0)).toBe(true);
    expect(result.iterations).toBe(0);
  });
});
