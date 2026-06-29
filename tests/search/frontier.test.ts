import { describe, expect, it } from 'vitest';
import { buildFrontier, pickNextFrontier } from '@/src/search/frontier';
import { buildCSR } from '@/src/graph/csr';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';

describe('frontier', () => {
  const snapshot: GraphSnapshot = {
    nodes: [
      { id: 1, kind: NodeKind.Work, key: '1', wordCount: null, estimatedFreq: 1, calibratedFreq: null, explored: true },
      { id: 2, kind: NodeKind.Tag, key: 't1', wordCount: null, estimatedFreq: 1, calibratedFreq: null, explored: false },
      { id: 3, kind: NodeKind.Work, key: '2', wordCount: null, estimatedFreq: 1, calibratedFreq: null, explored: false },
    ],
    edges: [{ workNodeId: 1, tagNodeId: 2 }, { workNodeId: 3, tagNodeId: 2 }],
    authorEdges: [],
  };

  it('includes only unexplored nodes sorted by expected information', () => {
    const csr = buildCSR(snapshot);
    const relevance = new Float64Array(csr.nodeCount);
    const authority = new Float64Array(csr.nodeCount);
    const precision = new Float64Array(csr.nodeCount).fill(1);
    relevance[csr.indexByNodeId.get(2)!] = 0.9;
    relevance[csr.indexByNodeId.get(3)!] = 0.1;
    authority[csr.indexByNodeId.get(2)!] = 0.9;
    authority[csr.indexByNodeId.get(3)!] = 0.9;

    const frontier = buildFrontier(csr, relevance, authority, precision);
    expect(frontier.length).toBe(2);
    expect(frontier[0].nodeId).toBe(2);
    expect(frontier[1].nodeId).toBe(3);
    expect(frontier[0].expectedInfo).toBeGreaterThan(frontier[1].expectedInfo);
  });

  it('usually picks the highest expected-info frontier node', () => {
    const frontier = [
      { nodeId: 2, index: 1, relevance: 0.9, authority: 0.9, precision: 1, expectedInfo: 0.81 },
      { nodeId: 3, index: 2, relevance: 0.1, authority: 0.9, precision: 1, expectedInfo: 0.09 },
    ];
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    expect(pickNextFrontier(frontier)?.nodeId).toBe(2);
    Math.random = originalRandom;
  });
});
