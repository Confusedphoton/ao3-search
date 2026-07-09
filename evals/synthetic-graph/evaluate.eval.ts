import { describe, expect, it } from 'vitest';
import {
  buildEvalCorpus,
  CORPUS_SIZE_MIN_WORKS,
  CORPUS_SIZE_PRESETS,
  type CorpusSizePreset,
} from './corpus';
import {
  DEFAULT_DEPTHS,
  DEFAULT_K_SWEEP,
  evaluateExpandingSubgraphs,
  formatEvaluationReport,
} from './evaluate';
import { extractDepthBall } from './subgraph';

interface CorpusEvalCase {
  size: CorpusSizePreset;
  /** Cap seeds so larger corpora stay intensive but finish in reasonable wall time. */
  maxSeeds: number;
  timeoutMs: number;
}

const CORPUS_EVAL_CASES: CorpusEvalCase[] = [
  { size: 'small', maxSeeds: Infinity, timeoutMs: 300_000 },
  { size: 'medium', maxSeeds: 12, timeoutMs: 600_000 },
  { size: 'large', maxSeeds: 10, timeoutMs: 1_200_000 },
  { size: 'xlarge', maxSeeds: 8, timeoutMs: 2_400_000 },
  { size: 'xxlarge', maxSeeds: 6, timeoutMs: 3_600_000 },
];

/**
 * Intensive expanding-subgraph NDCG evaluation.
 * Excluded from `npm test` — run via `npm run eval:synthetic-graph`.
 */
describe('synthetic graph expanding-subgraph NDCG evaluation', () => {
  for (const { size, maxSeeds, timeoutMs } of CORPUS_EVAL_CASES) {
    it(
      `bootstraps full-graph relevance and scores depth-ball approximations (${size} corpus)`,
      () => {
        const config = CORPUS_SIZE_PRESETS[size];
        const corpus = buildEvalCorpus(config);
        const seedKeys = corpus.targetSeedKeys.slice(0, maxSeeds);
        const report = evaluateExpandingSubgraphs(corpus, {
          depths: DEFAULT_DEPTHS,
          ks: DEFAULT_K_SWEEP,
          seedKeys,
        });

        console.log(`\n[${size}]\n${formatEvaluationReport(report)}\n`);

        expect(report.corpus.works).toBeGreaterThan(CORPUS_SIZE_MIN_WORKS[size]);
        expect(report.seeds.length).toBe(seedKeys.length);
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
        }

        const seedKey = report.seeds[0].seedKey;
        const seedIndex = corpus.graph.work(seedKey);
        const full = extractDepthBall(corpus.graph, seedIndex, report.seeds[0].eccentricity);
        expect(full.graph.nodeCount).toBe(corpus.graph.nodeCount);
      },
      timeoutMs,
    );
  }
});
