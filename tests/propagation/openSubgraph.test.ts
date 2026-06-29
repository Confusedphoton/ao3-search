import { describe, expect, it } from 'vitest';
import { l1Normalize } from '@/src/propagation/rules/pageRankStep';
import { buildTransitionWeights } from '@/src/propagation/queryGraph';
import { runRelevancePropagation } from '@/src/propagation';

describe('l1Normalize', () => {
  it('scales the state vector to unit L1 norm', () => {
    const state = new Float64Array([2, -1, 1]);
    l1Normalize(state);
    expect([...state]).toEqual([0.5, -0.25, 0.25]);
  });
});

describe('buildTransitionWeights', () => {
  it('scales rows to the requested outgoing fraction', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [2, 8];
    const rowOutFractions = new Float64Array([0.25, 1]);

    const transition = buildTransitionWeights(offsets, neighbors, edgeWeights, rowOutFractions);

    expect(transition[0]).toBeCloseTo(0.25, 6);
    expect(transition[1]).toBeCloseTo(1, 6);
  });
});

describe('open subgraph propagation', () => {
  it('produces a unit L1 norm relevance vector', () => {
    const result = runRelevancePropagation({
      offsets: [0, 1, 2],
      neighbors: [1, 0],
      edgeWeights: [1, 1],
      rowOutFractions: [1, 0.1],
      seedIndices: [0],
      alpha: 0.15,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    const norm = [...result.relevance].reduce((sum, value) => sum + Math.abs(value), 0);
    expect(norm).toBeCloseTo(1, 6);
  });

  it('row out fractions change the relevance distribution', () => {
    const base = {
      offsets: [0, 1, 2],
      neighbors: [1, 0],
      edgeWeights: [1, 1],
      rowOutFractions: [1, 1],
      seedIndices: [0],
      alpha: 0.15,
      maxIterations: 200,
      tolerance: 1e-8,
    };

    const closed = runRelevancePropagation(base);
    const open = runRelevancePropagation({ ...base, rowOutFractions: [1, 0.1] });

    expect([...open.relevance]).not.toEqual([...closed.relevance]);
  });
});
