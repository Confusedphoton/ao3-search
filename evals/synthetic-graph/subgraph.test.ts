import { describe, expect, it } from 'vitest';
import { buildEvalCorpus } from './corpus';
import { bfsDistances, extractDepthBall, induceVisibleSubgraph } from './subgraph';

describe('depth-ball subgraphs', () => {
  it('includes only nodes within the requested hop radius', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 8,
      localTagsPerCommunity: 3,
      bridgeTags: 1,
      authorsPerCommunity: 2,
      bridgeWorks: 2,
      seed: 7,
    });
    const seedKey = corpus.targetSeedKeys[0];
    const seedIndex = corpus.graph.work(seedKey);
    const depth = 2;
    const { graph, includedIndices, distances } = extractDepthBall(
      corpus.graph,
      seedIndex,
      depth,
    );

    expect(includedIndices.length).toBe(graph.nodeCount);
    for (const index of includedIndices) {
      expect(distances.get(index)!).toBeLessThanOrEqual(depth);
    }

    const allDistances = bfsDistances(corpus.graph.csr!, seedIndex);
    for (const [index, dist] of allDistances) {
      if (dist <= depth) {
        expect(includedIndices).toContain(index);
      }
    }
  });

  it('marks the boundary as unexplored and the interior as explored', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 6,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 1,
      seed: 3,
    });
    const seedIndex = corpus.graph.work(corpus.targetSeedKeys[0]);
    const { graph, distances } = extractDepthBall(corpus.graph, seedIndex, 2);
    const csr = graph.csr!;

    for (let index = 0; index < csr.nodeCount; index++) {
      const parentIndex = corpus.graph.index(
        csr.nodeByIndex[index].kind,
        csr.nodeByIndex[index].key,
      );
      const dist = distances.get(parentIndex)!;
      if (dist < 2) {
        expect(csr.nodeByIndex[index].explored).toBe(true);
        expect(csr.rowOutFractions[index]).toBe(1);
      } else {
        expect(csr.nodeByIndex[index].explored).toBe(false);
        expect(csr.rowOutFractions[index]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('induceVisibleSubgraph', () => {
  it('keeps only the requested nodes and exploration mask', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 4,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 0,
      seed: 1,
    });
    const seedIndex = corpus.graph.work(corpus.targetSeedKeys[0]);
    const csr = corpus.graph.csr!;
    const neighbor = csr.neighbors[csr.offsets[seedIndex]];
    const visible = [seedIndex, neighbor];
    const explored = new Set([seedIndex]);
    const graph = induceVisibleSubgraph(corpus.graph, visible, explored);

    expect(graph.nodeCount).toBe(2);
    expect(graph.csr!.nodeByIndex[graph.work(corpus.targetSeedKeys[0])].explored).toBe(true);
  });
});
