import { describe, expect, it } from 'vitest';
import { computeTagPriorLogFromFlux } from '@/src/propagation/tagFlux';
import { NodeKind } from '@/src/graph/types';

describe('computeTagPriorLogFromFlux', () => {
  it('scores boundary permeability without re-diffusing relevance', () => {
    const offsets = [0, 1, 2, 3];
    const neighbors = [1, 0, 2, 1];
    const edgeWeights = [1, 1, 1, 1];
    const rowOutFractions = new Float64Array([1, 1, 1, 1]);
    const nodeKinds = [NodeKind.Work, NodeKind.Tag, NodeKind.Work, NodeKind.Tag];
    const tagIndices = [1, 3];
    const relevance = new Float64Array([1, 0, 0, 0]);

    const tagPriorLog = computeTagPriorLogFromFlux({
      nodeCount: 4,
      offsets,
      neighbors,
      edgeWeights,
      rowOutFractions,
      nodeKinds,
      tagIndices,
      relevance,
    });

    expect(tagPriorLog[0]).toBeGreaterThan(tagPriorLog[1]);
  });
});
