import { describe, expect, it } from 'vitest';
import { buildCSR, tagWeight } from '@/src/graph/csr';
import { outgoingOrder, rowOutFraction } from '@/src/graph/outgoingOrder';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';

describe('tagWeight', () => {
  it('decreases as tag frequency grows', () => {
    expect(tagWeight(1)).toBeGreaterThan(tagWeight(100));
    expect(tagWeight(100)).toBeGreaterThan(tagWeight(10000));
  });
});

describe('outgoingOrder', () => {
  it('uses calibrated frequency when available', () => {
    expect(
      outgoingOrder({
        id: 1,
        kind: NodeKind.Tag,
        key: 't',
        estimatedFreq: 2,
        calibratedFreq: 5000,
        explored: false,
      }),
    ).toBe(5000);
  });
});

describe('buildCSR', () => {
  it('stores raw edge weights and scales frontier rows by outgoing order', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: 1, kind: NodeKind.Work, key: '100', title: 'A', estimatedFreq: 1, calibratedFreq: null, explored: true },
        { id: 2, kind: NodeKind.Work, key: '200', title: 'B', estimatedFreq: 1, calibratedFreq: null, explored: false },
        { id: 3, kind: NodeKind.Tag, key: 'rare', estimatedFreq: 2, calibratedFreq: null, explored: false },
        { id: 4, kind: NodeKind.Tag, key: 'popular', estimatedFreq: 1, calibratedFreq: 5000, explored: false },
      ],
      edges: [
        { workNodeId: 1, tagNodeId: 3 },
        { workNodeId: 1, tagNodeId: 4 },
        { workNodeId: 2, tagNodeId: 3 },
      ],
      authorEdges: [],
    };

    const csr = buildCSR(snapshot);
    const workIndex = csr.nodeByIndex.findIndex((n) => n.key === '100');
    const incompleteWorkIndex = csr.nodeByIndex.findIndex((n) => n.key === '200');
    const rareIndex = csr.nodeByIndex.findIndex((n) => n.key === 'rare');
    const popularIndex = csr.nodeByIndex.findIndex((n) => n.key === 'popular');

    const start = csr.offsets[workIndex];
    const end = csr.offsets[workIndex + 1];
    let rareWeight = 0;
    let popularWeight = 0;
    for (let e = start; e < end; e++) {
      if (csr.neighbors[e] === rareIndex) rareWeight = csr.edgeWeights[e];
      if (csr.neighbors[e] === popularIndex) popularWeight = csr.edgeWeights[e];
    }

    expect(rareWeight).toBeGreaterThan(popularWeight);
    expect(csr.rowOutFractions[workIndex]).toBe(1);
    expect(csr.rowOutFractions[incompleteWorkIndex]).toBe(0.5);
    expect(csr.rowOutFractions[popularIndex]).toBeCloseTo(1 / 5000, 6);
    expect(csr.rowOutFractions[rareIndex]).toBe(
      rowOutFraction(csr.nodeByIndex[rareIndex], csr.offsets[rareIndex + 1] - csr.offsets[rareIndex]),
    );
  });
});
