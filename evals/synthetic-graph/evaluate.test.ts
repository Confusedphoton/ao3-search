import { describe, expect, it } from 'vitest';
import { createExpansionPolicy } from '@/src/search/expansionPolicy';
import { buildEvalCorpus } from './corpus';
import {
  consecutiveSeedPairs,
  evaluateFogOfWarSearch,
  evaluateWarmStartFogOfWarSearch,
  warmStartCellKey,
} from './evaluate';

describe('evaluateFogOfWarSearch', () => {
  it('scores iterative expansion budgets under a policy', () => {
    const corpus = buildEvalCorpus({
      communities: 3,
      worksPerCommunity: 12,
      localTagsPerCommunity: 3,
      bridgeTags: 2,
      authorsPerCommunity: 2,
      bridgeWorks: 2,
      seed: 5,
    });
    const report = evaluateFogOfWarSearch(corpus, {
      depths: [2, 4, 6],
      ks: [5, 10],
      seedKeys: corpus.targetSeedKeys.slice(0, 2),
      policy: 'expected-info',
    });

    expect(report.policy).toBe('expected-info');
    expect(report.depths).toEqual([2, 4, 6]);
    expect(report.seeds).toHaveLength(2);
    expect(report.overallMeanNdcg).toBeGreaterThan(0);

    for (const seed of report.seeds) {
      expect(seed.expansionsCompleted).toBeGreaterThanOrEqual(2);
      expect(seed.depths.map((d) => d.depth)).toEqual(
        seed.depths.map((d) => d.depth).sort((a, b) => a - b),
      );
      expect(seed.depths.length).toBeGreaterThan(0);
      const first = seed.depths[0];
      const last = seed.depths[seed.depths.length - 1];
      expect(last.nodeCount).toBeGreaterThanOrEqual(first.nodeCount);
    }
  });

  it('can evaluate the topological expansion policy', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 10,
      localTagsPerCommunity: 3,
      bridgeTags: 1,
      authorsPerCommunity: 2,
      bridgeWorks: 1,
      seed: 9,
    });
    const report = evaluateFogOfWarSearch(corpus, {
      depths: [3, 6],
      ks: [5, 10],
      seedKeys: [corpus.targetSeedKeys[0]],
      policy: createExpansionPolicy('topological'),
    });

    expect(report.policy).toBe('TopologicalExpansionPolicy');
    expect(report.seeds[0].depths.length).toBeGreaterThan(0);
    expect(report.overallMeanNdcg).toBeGreaterThanOrEqual(0);
  });
});

describe('evaluateWarmStartFogOfWarSearch', () => {
  it('conditions without NDCG then scores a switched seed from each partial graph', () => {
    const corpus = buildEvalCorpus({
      communities: 3,
      worksPerCommunity: 12,
      localTagsPerCommunity: 3,
      bridgeTags: 2,
      authorsPerCommunity: 2,
      bridgeWorks: 2,
      seed: 5,
    });
    const seedKeys = corpus.targetSeedKeys.slice(0, 3);
    const report = evaluateWarmStartFogOfWarSearch(corpus, {
      initialDepths: [2, 4],
      depths: [1, 3],
      ks: [5, 10],
      seedKeys,
      policy: 'expected-info',
    });

    expect(report.policy).toBe('expected-info');
    expect(report.initialDepths).toEqual([2, 4]);
    expect(report.depths).toEqual([1, 3]);
    expect(report.pairs).toHaveLength(consecutiveSeedPairs(seedKeys).length);
    expect(report.overallMeanNdcg).toBeGreaterThan(0);

    for (const pair of report.pairs) {
      expect(pair.conditionSeedKey).not.toBe(pair.measureSeedKey);
      expect(pair.groundTruthWorkCount).toBeGreaterThan(0);
      expect(pair.conditioningExpansionsCompleted).toBeGreaterThanOrEqual(2);

      const shallowInit = pair.byInitialDepth[2];
      const deepInit = pair.byInitialDepth[4];
      expect(shallowInit?.length).toBeGreaterThan(0);
      expect(deepInit?.length).toBeGreaterThan(0);

      const shallowCondNodes = shallowInit![0]!.conditionedNodeCount;
      const deepCondNodes = deepInit![0]!.conditionedNodeCount;
      expect(deepCondNodes).toBeGreaterThanOrEqual(shallowCondNodes);

      for (const depth of [...shallowInit!, ...deepInit!]) {
        expect(depth.meanNdcg).toBeGreaterThanOrEqual(0);
        expect(depth.meanNdcg).toBeLessThanOrEqual(1);
        expect(depth.nodeCount).toBeGreaterThanOrEqual(depth.conditionedNodeCount);
      }
    }

    expect(report.meanNdcgByInitialAndDepth[warmStartCellKey(2, 1)]).toBeGreaterThanOrEqual(0);
    expect(report.meanNdcgByInitialAndDepth[warmStartCellKey(4, 3)]).toBeGreaterThanOrEqual(0);
  });

  it('rejects identical condition and measure seeds', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 8,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 1,
      seed: 2,
    });
    expect(() =>
      evaluateWarmStartFogOfWarSearch(corpus, {
        initialDepths: [1],
        depths: [1],
        ks: [5],
        seedPairs: [
          {
            conditionSeedKey: corpus.targetSeedKeys[0],
            measureSeedKey: corpus.targetSeedKeys[0],
          },
        ],
      }),
    ).toThrow(/distinct seeds/);
  });
});
