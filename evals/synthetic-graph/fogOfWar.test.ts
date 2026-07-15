import { describe, expect, it } from 'vitest';
import { createExpansionPolicy } from '@/src/search/expansionPolicy';
import { buildEvalCorpus } from './corpus';
import { FogOfWar, selectNextExpansion } from './fogOfWar';

describe('fog-of-war exploration', () => {
  it('cold-starts with the seed explored and neighbors visible', () => {
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
    const fog = FogOfWar.fromSeed(corpus.graph, seedIndex);
    const csr = corpus.graph.csr!;

    expect(fog.explored.has(seedIndex)).toBe(true);
    expect(fog.visible.has(seedIndex)).toBe(true);

    const begin = csr.offsets[seedIndex];
    const end = csr.offsets[seedIndex + 1];
    for (let edge = begin; edge < end; edge++) {
      const neighbor = csr.neighbors[edge];
      expect(fog.visible.has(neighbor)).toBe(true);
      expect(fog.explored.has(neighbor)).toBe(false);
    }

    const subgraph = fog.materialize();
    expect(subgraph.nodeCount).toBe(fog.visible.size);
    const seedInSub = subgraph.work(corpus.targetSeedKeys[0]);
    expect(subgraph.csr!.nodeByIndex[seedInSub].explored).toBe(true);
  });

  it('expands one node at a time and grows the visible set', () => {
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
    const fog = FogOfWar.fromSeed(corpus.graph, corpus.graph.work(seedKey));
    const policy = createExpansionPolicy('expected-info');
    const sizes = [fog.visible.size];

    for (let step = 0; step < 8; step++) {
      const next = selectNextExpansion(fog, policy, fog.observe(seedKey));
      expect(next).not.toBeNull();
      fog.expand(next!);
      sizes.push(fog.visible.size);
    }

    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0]);
    expect(fog.explored.size).toBe(1 + 8);
  });

  it('marks unexplored frontier rows as open (leaky)', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 6,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 1,
      seed: 11,
    });
    const seedKey = corpus.targetSeedKeys[0];
    const fog = FogOfWar.fromSeed(corpus.graph, corpus.graph.work(seedKey));
    const subgraph = fog.materialize();
    const csr = subgraph.csr!;

    let sawOpen = false;
    for (let index = 0; index < csr.nodeCount; index++) {
      if (csr.nodeByIndex[index].explored) {
        expect(csr.rowOutFractions[index]).toBe(1);
      } else {
        expect(csr.rowOutFractions[index]).toBeLessThanOrEqual(1);
        if (csr.rowOutFractions[index] < 1) sawOpen = true;
      }
    }
    expect(sawOpen).toBe(true);
  });

  it('clone snapshots visible and explored independently', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 6,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 1,
      seed: 13,
    });
    const seedKey = corpus.targetSeedKeys[0];
    const fog = FogOfWar.fromSeed(corpus.graph, corpus.graph.work(seedKey));
    const policy = createExpansionPolicy('expected-info');
    const next = selectNextExpansion(fog, policy, fog.observe(seedKey));
    expect(next).not.toBeNull();
    fog.expand(next!);

    const snapshot = fog.clone();
    expect(snapshot.visible.size).toBe(fog.visible.size);
    expect(snapshot.explored.size).toBe(fog.explored.size);

    const next2 = selectNextExpansion(fog, policy, fog.observe(seedKey));
    expect(next2).not.toBeNull();
    fog.expand(next2!);

    expect(fog.explored.size).toBe(snapshot.explored.size + 1);
    expect(snapshot.explored.size).toBeLessThan(fog.explored.size);
  });
});
