import { describe, expect, it } from 'vitest';
import { buildCSR, seedIndicesForPositiveSeeds } from '@/src/graph/csr';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';

describe('buildCSR author edges', () => {
  it('connects works through author hubs', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: 1, kind: NodeKind.Work, key: '100', title: 'Seed', estimatedFreq: 1, calibratedFreq: null, explored: true },
        { id: 2, kind: NodeKind.Work, key: '200', title: 'Other', estimatedFreq: 1, calibratedFreq: null, explored: false },
        { id: 3, kind: NodeKind.Author, key: 'writer', title: 'Writer', estimatedFreq: 2, calibratedFreq: null, explored: false },
      ],
      edges: [],
      authorEdges: [
        { workNodeId: 1, authorNodeId: 3 },
        { workNodeId: 2, authorNodeId: 3 },
      ],
    };

    const csr = buildCSR(snapshot);
    expect(csr.authorIndices.length).toBe(1);

    const workSeedIndex = csr.nodeByIndex.findIndex((n) => n.key === '100');
    const authorIndex = csr.nodeByIndex.findIndex((n) => n.key === 'writer');
    const workOtherIndex = csr.nodeByIndex.findIndex((n) => n.key === '200');

    const seedStart = csr.offsets[workSeedIndex];
    const seedEnd = csr.offsets[workSeedIndex + 1];
    let seedToAuthor = 0;
    for (let e = seedStart; e < seedEnd; e++) {
      if (csr.neighbors[e] === authorIndex) seedToAuthor = csr.edgeWeights[e];
    }
    expect(seedToAuthor).toBeGreaterThan(0);

    const authorStart = csr.offsets[authorIndex];
    const authorEnd = csr.offsets[authorIndex + 1];
    const authorNeighbors = csr.neighbors.slice(authorStart, authorEnd);
    expect(authorNeighbors).toContain(workSeedIndex);
    expect(authorNeighbors).toContain(workOtherIndex);
  });

  it('resolves author seeds to graph indices', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: 1, kind: NodeKind.Work, key: '100', title: 'Seed', estimatedFreq: 1, calibratedFreq: null, explored: true },
        { id: 2, kind: NodeKind.Author, key: 'Lake/pseuds/PseudName', title: 'Pseud Name', estimatedFreq: 2, calibratedFreq: null, explored: false },
      ],
      edges: [],
      authorEdges: [{ workNodeId: 1, authorNodeId: 2 }],
    };

    const csr = buildCSR(snapshot);
    const indices = seedIndicesForPositiveSeeds(csr, [
      { kind: 'author', key: 'Lake/pseuds/PseudName' },
    ]);

    expect(indices).toHaveLength(1);
    expect(csr.nodeByIndex[indices[0]].key).toBe('Lake/pseuds/PseudName');
  });
});
