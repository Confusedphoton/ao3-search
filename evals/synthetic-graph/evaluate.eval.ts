import { describe, expect, it } from 'vitest';
import { buildEvalCorpus, DEFAULT_CORPUS_CONFIG } from './corpus';
import {
  DEFAULT_DEPTHS,
  DEFAULT_K_SWEEP,
  evaluateExpandingSubgraphs,
  formatEvaluationReport,
} from './evaluate';
import { extractDepthBall } from './subgraph';

/**
 * Intensive expanding-subgraph NDCG evaluation.
 * Excluded from `npm test` — run via `npm run eval:synthetic-graph`.
 */
describe('synthetic graph expanding-subgraph NDCG evaluation', () => {
  it('bootstraps full-graph relevance and scores depth-ball approximations', () => {
    const corpus = buildEvalCorpus(DEFAULT_CORPUS_CONFIG);
    const report = evaluateExpandingSubgraphs(corpus, {
      depths: DEFAULT_DEPTHS,
      ks: DEFAULT_K_SWEEP,
    });

    console.log(`\n${formatEvaluationReport(report)}\n`);

    expect(report.corpus.works).toBeGreaterThan(100);
    expect(report.seeds.length).toBe(report.corpus.seedCount);
    expect(report.overallMeanNdcg).toBeGreaterThan(0);
    expect(report.overallMeanNdcg).toBeLessThanOrEqual(1);

    for (const seed of report.seeds) {
      expect(seed.groundTruthWorkCount).toBeGreaterThan(0);
      expect(seed.depths.length).toBeGreaterThan(0);

      const shallow = seed.depths[0];
      const deep = seed.depths[seed.depths.length - 1];
      expect(deep.nodeCount).toBeGreaterThanOrEqual(shallow.nodeCount);
      expect(deep.workCount).toBeGreaterThanOrEqual(shallow.workCount);

      for (const depth of seed.depths) {
        expect(depth.meanNdcg).toBeGreaterThanOrEqual(0);
        expect(depth.meanNdcg).toBeLessThanOrEqual(1);
        for (const k of report.ks) {
          expect(depth.ndcgByK[k]).toBeGreaterThanOrEqual(0);
          expect(depth.ndcgByK[k]).toBeLessThanOrEqual(1);
        }
      }

      // Depth 1 is seed + hubs only (no sibling works), so ranking NDCG is 0.
      const depth1 = seed.depths.find((entry) => entry.depth === 1);
      if (depth1) {
        expect(depth1.workCount).toBe(1);
        expect(depth1.meanNdcg).toBe(0);
      }
    }

    const seedKey = report.seeds[0].seedKey;
    const seedIndex = corpus.graph.work(seedKey);
    const full = extractDepthBall(corpus.graph, seedIndex, report.seeds[0].eccentricity);
    expect(full.graph.nodeCount).toBe(corpus.graph.nodeCount);
  }, 300_000);
});
