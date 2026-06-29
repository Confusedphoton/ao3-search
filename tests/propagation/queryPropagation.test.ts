import { describe, expect, it } from 'vitest';
import { runQueryPropagation } from '@/src/propagation/runQueryPropagation';
import { NodeKind } from '@/src/graph/types';

describe('runQueryPropagation', () => {
  it('returns relevance, authority, precision, and expectedInfo vectors', () => {
    const offsets = [0, 1, 3, 4];
    const neighbors = [1, 0, 2, 1];
    const edgeWeights = [1, 1, 1, 1];
    const rowOutFractions = new Float64Array([1, 1, 1, 1]);

    const result = runQueryPropagation({
      offsets,
      neighbors,
      edgeWeights,
      rowOutFractions,
      seedIndices: [0],
      workIndices: [0, 2],
      tagIndices: [1],
      authorIndices: [],
      authorWorkIndexEdges: [],
      wordCounts: [5000, null, null],
      nodeKinds: [NodeKind.Work, NodeKind.Tag, NodeKind.Work],
      alpha: 0.5,
      maxIterations: 100,
      tolerance: 1e-8,
    });

    const relevanceNorm = [...result.relevance].reduce((sum, v) => sum + Math.abs(v), 0);
    const authorityNorm = [...result.authority].reduce((sum, v) => sum + Math.abs(v), 0);

    expect(relevanceNorm).toBeCloseTo(1, 4);
    expect(authorityNorm).toBeCloseTo(1, 4);
    expect(result.precision.every((v) => v > 0)).toBe(true);
    expect(result.expectedInfo.some((v) => v > 0)).toBe(true);
    expect(result.iterations.relevance).toBeGreaterThan(0);
    expect(result.iterations.authority).toBeGreaterThan(0);
  });
});
