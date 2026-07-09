import { describe, expect, it } from 'vitest';
import { runMultiSignalPropagation, runRelevancePropagation } from '@/src/propagation';
import { runPropagation } from '@/src/propagation/engine';
import { buildPropagationGraphFromArrays } from '@/src/propagation/queryGraph';
import {
  createRelevanceSignal,
  createSeedContext,
  RELEVANCE_SIGNAL_ID,
} from '@/src/propagation/signals/relevance';

describe('runPropagation', () => {
  const lineGraph = {
    offsets: [0, 1, 3, 4],
    neighbors: [1, 0, 2, 1],
    edgeWeights: [1, 1, 1, 1],
  };

  it('propagates relevance over the graph', () => {
    const graph = buildPropagationGraphFromArrays(
      lineGraph.offsets,
      lineGraph.neighbors,
      lineGraph.edgeWeights,
    );
    const context = createSeedContext(3, [0]);
    const params = { alpha: 0.5, maxIterations: 200, tolerance: 1e-8 };

    const result = runPropagation(graph, [createRelevanceSignal(context)], params);

    expect(result.signals[RELEVANCE_SIGNAL_ID]![0]).toBeGreaterThan(
      result.signals[RELEVANCE_SIGNAL_ID]![2]!,
    );
    expect(result.iterations).toBeGreaterThan(0);
  });
});

describe('runMultiSignalPropagation', () => {
  it('matches runRelevancePropagation on the same fixture', () => {
    const input = {
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
      signalIds: [RELEVANCE_SIGNAL_ID],
    };

    const direct = runRelevancePropagation(input);
    const multi = runMultiSignalPropagation(input);

    expect([...multi.signals[RELEVANCE_SIGNAL_ID]!]).toEqual([...direct.relevance]);
  });
});

describe('runRelevancePropagation', () => {
  it('concentrates relevance on nodes connected to seeds', () => {
    const result = runRelevancePropagation({
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    expect(result.relevance[0]).toBeGreaterThan(result.relevance[2]);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('down-ranks nodes near negative seeds via dual PPR contrast', () => {
    const positiveOnly = runRelevancePropagation({
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    const contrasted = runRelevancePropagation({
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      negativeSeedIndices: [2],
      negativeLambda: 3,
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    });

    expect(contrasted.relevance[2]).toBeLessThan(positiveOnly.relevance[2]);
    expect(contrasted.negativeRelevance).not.toBeNull();
    expect(contrasted.negativeRelevance![2]).toBeGreaterThan(
      contrasted.negativeRelevance![0],
    );
    expect(contrasted.relevance[2]).toBeLessThan(contrasted.positiveRelevance[2]);
  });
});
