import { describe, expect, it } from 'vitest';
import { runPPR } from '@/src/ppr/solver';

describe('runPPR', () => {
  it('concentrates authority on nodes connected to seeds', () => {
    // Line 0 — 1 — 2, seed at 0
    const offsets = [0, 1, 3, 4];
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

  it('penalizes nodes connected to negative seed sinks', () => {
    // Line 0 — 1 — 2, positive seed 0, negative seed 2
    const offsets = [0, 1, 3, 4];
    const neighbors = [1, 0, 2, 1];
    const edgeWeights = [1, 1, 1, 1];

    const positiveOnly = runPPR({
      offsets,
      neighbors,
      edgeWeights,
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    const signed = runPPR({
      offsets,
      neighbors,
      edgeWeights,
      seedIndices: [0],
      negativeSeedIndices: [2],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    expect(signed.authority[2]).toBeLessThan(positiveOnly.authority[2]);
    expect(signed.authority[2]).toBeLessThan(0);
  });
});
