import { describe, expect, it } from 'vitest';
import { buildEvalCorpus } from './corpus';
import { resolveEvalPolicy } from './cliPolicy';
import {
  DEFAULT_DEPTHS,
  DEFAULT_INITIAL_DEPTHS,
  DEFAULT_K_SWEEP,
  evaluateFogOfWarSearch,
  evaluateWarmStartFogOfWarSearch,
  formatEvaluationReport,
  formatWarmStartEvaluationReport,
  warmStartCellKey,
} from './evaluate';
import {
  CORPUS_SIZE_MIN_WORKS,
  CORPUS_SIZE_PRESETS,
  type CorpusSizePreset,
} from './corpus';

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

const EVAL_POLICY = resolveEvalPolicy();

/**
 * Intensive fog-of-war NDCG evaluation under a fixed expansion budget.
 * Excluded from `npm test` — run via:
 *   npm run eval:synthetic-graph -- --policy=topological
 *   npm run eval:synthetic-graph -- --policy=topo-query
 */
describe('synthetic graph fog-of-war NDCG evaluation', () => {
  for (const { size, maxSeeds, timeoutMs } of CORPUS_EVAL_CASES) {
    it(
      `scores policy-guided fog-of-war search at expansion budgets (${size} corpus)`,
      () => {
        const config = CORPUS_SIZE_PRESETS[size];
        const corpus = buildEvalCorpus(config);
        const seedKeys = corpus.targetSeedKeys.slice(0, maxSeeds);
        const report = evaluateFogOfWarSearch(corpus, {
          depths: DEFAULT_DEPTHS,
          ks: DEFAULT_K_SWEEP,
          seedKeys,
          policy: EVAL_POLICY,
        });

        console.log(`\n[${size}]\n${formatEvaluationReport(report)}\n`);

        expect(report.corpus.works).toBeGreaterThan(CORPUS_SIZE_MIN_WORKS[size]);
        expect(report.policy).toBe(EVAL_POLICY);
        expect(report.seeds.length).toBe(seedKeys.length);
        expect(report.overallMeanNdcg).toBeGreaterThan(0);
        expect(report.overallMeanNdcg).toBeLessThanOrEqual(1);

        for (const seed of report.seeds) {
          expect(seed.groundTruthWorkCount).toBeGreaterThan(0);
          expect(seed.depths.length).toBeGreaterThan(0);
          expect(seed.expansionsCompleted).toBeGreaterThan(0);

          const shallow = seed.depths[0];
          const deep = seed.depths[seed.depths.length - 1];
          expect(deep.depth).toBeGreaterThanOrEqual(shallow.depth);
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
      },
      timeoutMs,
    );
  }
});

/**
 * Warm-start: explore under seed A at initial budgets (no NDCG), then score
 * seed B from each partial graph across a measure-depth sweep.
 *   npm run eval:synthetic-graph -- -t "warm-start"
 */
describe('synthetic graph warm-start fog-of-war NDCG evaluation', () => {
  for (const { size, maxSeeds, timeoutMs } of CORPUS_EVAL_CASES) {
    it(
      `scores switched-seed search from conditioned partial graphs (${size} corpus)`,
      () => {
        const config = CORPUS_SIZE_PRESETS[size];
        const corpus = buildEvalCorpus(config);
        const seedKeys = corpus.targetSeedKeys.slice(0, Math.max(2, maxSeeds));
        const report = evaluateWarmStartFogOfWarSearch(corpus, {
          initialDepths: DEFAULT_INITIAL_DEPTHS,
          depths: DEFAULT_DEPTHS,
          ks: DEFAULT_K_SWEEP,
          seedKeys,
          policy: EVAL_POLICY,
        });

        console.log(`\n[${size} warm-start]\n${formatWarmStartEvaluationReport(report)}\n`);

        expect(report.corpus.works).toBeGreaterThan(CORPUS_SIZE_MIN_WORKS[size]);
        expect(report.policy).toBe(EVAL_POLICY);
        expect(report.initialDepths).toEqual([...DEFAULT_INITIAL_DEPTHS]);
        expect(report.depths).toEqual([...DEFAULT_DEPTHS]);
        expect(report.pairs.length).toBe(seedKeys.length);
        expect(report.overallMeanNdcg).toBeGreaterThan(0);
        expect(report.overallMeanNdcg).toBeLessThanOrEqual(1);

        for (const pair of report.pairs) {
          expect(pair.conditionSeedKey).not.toBe(pair.measureSeedKey);
          expect(pair.groundTruthWorkCount).toBeGreaterThan(0);
          expect(pair.conditioningExpansionsCompleted).toBeGreaterThan(0);

          let previousCondNodes = 0;
          for (const initial of report.initialDepths) {
            const depths = pair.byInitialDepth[initial];
            expect(depths?.length).toBeGreaterThan(0);
            const condNodes = depths![0]!.conditionedNodeCount;
            expect(condNodes).toBeGreaterThanOrEqual(previousCondNodes);
            previousCondNodes = condNodes;

            const shallow = depths![0]!;
            const deep = depths![depths!.length - 1]!;
            expect(deep.nodeCount).toBeGreaterThanOrEqual(shallow.nodeCount);

            for (const depth of depths!) {
              expect(depth.meanNdcg).toBeGreaterThanOrEqual(0);
              expect(depth.meanNdcg).toBeLessThanOrEqual(1);
              for (const k of report.ks) {
                expect(depth.ndcgByK[k]).toBeGreaterThanOrEqual(0);
                expect(depth.ndcgByK[k]).toBeLessThanOrEqual(1);
              }
            }
          }
        }

        for (const initial of report.initialDepths) {
          for (const depth of report.depths) {
            const value = report.meanNdcgByInitialAndDepth[warmStartCellKey(initial, depth)];
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      },
      // Conditioning × measure sweeps cost more than cold-start alone.
      timeoutMs * 3,
    );
  }
});
