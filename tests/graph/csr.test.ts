import { describe, expect, it } from 'vitest';
import { buildCSR, tagWeight } from '@/src/graph/csr';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';

describe('tagWeight', () => {
  it('decreases as tag frequency grows', () => {
    expect(tagWeight(1)).toBeGreaterThan(tagWeight(100));
    expect(tagWeight(100)).toBeGreaterThan(tagWeight(10000));
  });
});

describe('buildCSR', () => {
  it('normalizes outgoing edge weights and weights rare tags higher', () => {
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
    };

    const csr = buildCSR(snapshot);
    const workIndex = csr.nodeByIndex.findIndex((n) => n.key === '100');
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

    for (let node = 0; node < csr.nodeCount; node++) {
      const s = csr.offsets[node];
      const t = csr.offsets[node + 1];
      if (t === s) continue;
      const sum = csr.edgeWeights.slice(s, t).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});
