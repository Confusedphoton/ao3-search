import { describe, expect, it } from 'vitest';
import { runMultiSignalPropagation, runRankPropagation } from '@/src/propagation';
import { runPropagation } from '@/src/propagation/engine';
import { buildPropagationGraphFromArrays } from '@/src/propagation/queryGraph';
import {
  CONFIDENCE_SIGNAL_ID,
  createConfidenceSignal,
} from '@/src/propagation/signals/confidence';
import {
  createRankSeedContext,
  createRankSignal,
  RANK_SIGNAL_ID,
} from '@/src/propagation/signals/rank';
import { runPPR } from '@/src/ppr/solver';

describe('runPropagation', () => {
  const lineGraph = {
    offsets: [0, 1, 3, 4],
    neighbors: [1, 0, 2, 1],
    edgeWeights: [1, 1, 1, 1],
  };

  it('propagates multiple signals over the same graph', () => {
    const graph = buildPropagationGraphFromArrays(
      lineGraph.offsets,
      lineGraph.neighbors,
      lineGraph.edgeWeights,
    );
    const context = createRankSeedContext(3, [0]);
    const params = { alpha: 0.5, maxIterations: 200, tolerance: 1e-8 };

    const result = runPropagation(
      graph,
      [createRankSignal(context), createConfidenceSignal(context)],
      params,
    );

    expect(result.signals[RANK_SIGNAL_ID]![0]).toBeGreaterThan(result.signals[RANK_SIGNAL_ID]![2]!);
    expect(result.signals[CONFIDENCE_SIGNAL_ID]!.every((v) => v === 0)).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
  });
});

describe('runMultiSignalPropagation', () => {
  it('rank matches legacy runPPR on the same fixture', () => {
    const input = {
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
      signalIds: [RANK_SIGNAL_ID, CONFIDENCE_SIGNAL_ID],
    };

    const legacy = runPPR(input);
    const multi = runMultiSignalPropagation(input);

    expect([...multi.signals[RANK_SIGNAL_ID]!]).toEqual([...legacy.authority]);
    expect(multi.signals[CONFIDENCE_SIGNAL_ID]!.every((v) => v === 0)).toBe(true);
  });
});

describe('runRankPropagation', () => {
  it('matches runPPR adapter', () => {
    const input = {
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      seedIndices: [0],
      negativeSeedIndices: [2],
      alpha: 0.5,
      maxIterations: 200,
      tolerance: 1e-8,
    };

    const legacy = runPPR(input);
    const rank = runRankPropagation(input);

    expect([...rank.authority]).toEqual([...legacy.authority]);
    expect(rank.iterations).toBe(legacy.iterations);
  });
});
