import {
  createExpansionPolicy,
  type ExpansionPolicy,
  type ExpansionPolicyKind,
} from '@/src/search/expansionPolicy';
import { runQueryPropagation } from '@/src/propagation';
import type { EvalCorpus } from './corpus';
import { FogOfWar, selectNextExpansion, type FogObservation } from './fogOfWar';
import { meanNdcgAtKs, ndcgAtK } from './ndcg';
import { bfsDistances, maxFiniteDistance } from './subgraph';

export const DEFAULT_K_SWEEP = [5, 10, 20, 25, 50] as const;

/** Expansion-budget checkpoints (allowed policy requests after seed cold-start). */
export const DEFAULT_DEPTHS = [5, 10, 20, 30, 40, 50] as const;

/**
 * Conditioning budgets for warm-start eval: explore under one seed without
 * scoring, then measure a different query from each partial graph.
 */
export const DEFAULT_INITIAL_DEPTHS = [10, 20, 40] as const;

export interface EvaluateOptions {
  /** Expansion budgets at which to score ranking quality. */
  depths?: readonly number[];
  /** NDCG cutoffs; reported score is the mean across these Ks. */
  ks?: readonly number[];
  /** Override seed work keys; defaults to corpus.targetSeedKeys. */
  seedKeys?: string[];
  /**
   * Exploration policy under test. Defaults to expected-information.
   * Pass a kind or a concrete policy instance.
   */
  policy?: ExpansionPolicyKind | ExpansionPolicy;
}

export interface DepthScore {
  /** Number of node expansions allowed after seed cold-start. */
  depth: number;
  nodeCount: number;
  workCount: number;
  /** Mean of NDCG@K over the K sweep for this seed/depth. */
  meanNdcg: number;
  /** Per-K breakdown. */
  ndcgByK: Record<number, number>;
}

export interface SeedEvaluation {
  seedKey: string;
  eccentricity: number;
  groundTruthWorkCount: number;
  expansionsCompleted: number;
  depths: DepthScore[];
}

export interface EvaluationReport {
  corpus: {
    communities: number;
    works: number;
    tags: number;
    authors: number;
    seedCount: number;
  };
  policy: string;
  ks: number[];
  depths: number[];
  seeds: SeedEvaluation[];
  /** Mean mean-NDCG across seeds, keyed by expansion budget. */
  meanNdcgByDepth: Record<number, number>;
  /** Grand mean over all seed×depth cells that were evaluated. */
  overallMeanNdcg: number;
}

function workGainMap(
  graph: EvalCorpus['graph'],
  relevance: ArrayLike<number>,
  excludeKeys: Set<string>,
): Map<string, number> {
  const csr = graph.csr!;
  const gains = new Map<string, number>();
  for (const index of csr.workIndices) {
    const key = csr.nodeByIndex[index].key;
    if (excludeKeys.has(key)) continue;
    const gain = Math.max(0, relevance[index]);
    if (gain > 0) gains.set(key, gain);
  }
  return gains;
}

function rankedWorkKeysExcluding(
  graph: EvalCorpus['graph'],
  relevance: ArrayLike<number>,
  excludeKeys: Set<string>,
): string[] {
  const csr = graph.csr!;
  return [...csr.workIndices]
    .filter((index) => !excludeKeys.has(csr.nodeByIndex[index].key))
    .sort((a, b) => relevance[b] - relevance[a])
    .map((index) => csr.nodeByIndex[index].key);
}

function bootstrapGroundTruth(
  corpus: EvalCorpus,
  seedKey: string,
): { gains: Map<string, number>; eccentricity: number } {
  const seedIndex = corpus.graph.work(seedKey);
  const result = runQueryPropagation(
    corpus.graph.queryInput({ positive: { works: [seedKey] } }),
  );
  const gains = workGainMap(corpus.graph, result.relevance, new Set([seedKey]));
  const distances = bfsDistances(corpus.graph.csr!, seedIndex);
  return {
    gains,
    eccentricity: maxFiniteDistance(distances),
  };
}

function resolvePolicy(
  policy: ExpansionPolicyKind | ExpansionPolicy | undefined,
): { policy: ExpansionPolicy; label: string } {
  if (policy == null) {
    return { policy: createExpansionPolicy('expected-info'), label: 'expected-info' };
  }
  if (typeof policy === 'string') {
    return { policy: createExpansionPolicy(policy), label: policy };
  }
  const label =
    policy.constructor?.name && policy.constructor.name !== 'Object'
      ? policy.constructor.name
      : 'custom';
  return { policy, label };
}

function scoreObservation(
  observation: FogObservation,
  seedKey: string,
  gains: Map<string, number>,
  ks: number[],
  depth: number,
): DepthScore {
  const predicted = rankedWorkKeysExcluding(
    observation.subgraph,
    observation.relevance,
    new Set([seedKey]),
  );

  const ndcgByK: Record<number, number> = {};
  for (const k of ks) {
    ndcgByK[k] = ndcgAtK(predicted, gains, k);
  }

  return {
    depth,
    nodeCount: observation.subgraph.nodeCount,
    workCount: observation.subgraph.workIndices.length,
    meanNdcg: meanNdcgAtKs(predicted, gains, ks),
    ndcgByK,
  };
}

/**
 * Full-graph bootstrap relevance as graded labels, then score iterative
 * fog-of-war search: the policy expands one visible node per request and
 * ranking is measured on the revealed subgraph at each expansion budget.
 */
export function evaluateFogOfWarSearch(
  corpus: EvalCorpus,
  options: EvaluateOptions = {},
): EvaluationReport {
  const ks = [...(options.ks ?? DEFAULT_K_SWEEP)];
  const requestedDepths = [...(options.depths ?? DEFAULT_DEPTHS)].sort((a, b) => a - b);
  const seedKeys = options.seedKeys ?? corpus.targetSeedKeys;
  const { policy, label: policyLabel } = resolvePolicy(options.policy);
  const maxBudget = requestedDepths.length > 0 ? requestedDepths[requestedDepths.length - 1]! : 0;
  const scoreAt = new Set(requestedDepths);

  const seeds: SeedEvaluation[] = [];
  const depthAccum = new Map<number, { sum: number; count: number }>();

  for (const seedKey of seedKeys) {
    const { gains, eccentricity } = bootstrapGroundTruth(corpus, seedKey);
    const seedIndex = corpus.graph.work(seedKey);
    const fog = FogOfWar.fromSeed(corpus.graph, seedIndex);
    const depthScores: DepthScore[] = [];

    let expansionsDone = 0;
    while (true) {
      const observation = fog.observe(seedKey);

      if (scoreAt.has(expansionsDone)) {
        const scored = scoreObservation(observation, seedKey, gains, ks, expansionsDone);
        depthScores.push(scored);
        const bucket = depthAccum.get(expansionsDone) ?? { sum: 0, count: 0 };
        bucket.sum += scored.meanNdcg;
        bucket.count += 1;
        depthAccum.set(expansionsDone, bucket);
      }

      if (expansionsDone >= maxBudget) break;

      const next = selectNextExpansion(fog, policy, observation);
      if (next == null) break;

      fog.expand(next);
      expansionsDone += 1;
    }

    seeds.push({
      seedKey,
      eccentricity,
      groundTruthWorkCount: gains.size,
      expansionsCompleted: expansionsDone,
      depths: depthScores,
    });
  }

  const meanNdcgByDepth: Record<number, number> = {};
  let overallSum = 0;
  let overallCount = 0;
  for (const [depth, { sum, count }] of depthAccum) {
    meanNdcgByDepth[depth] = count > 0 ? sum / count : 0;
    overallSum += sum;
    overallCount += count;
  }

  const csr = corpus.graph.csr!;
  return {
    corpus: {
      communities: corpus.config.communities,
      works: corpus.workKeys.length,
      tags: csr.tagIndices.length,
      authors: csr.authorIndices.length,
      seedCount: seedKeys.length,
    },
    policy: policyLabel,
    ks,
    depths: requestedDepths,
    seeds,
    meanNdcgByDepth,
    overallMeanNdcg: overallCount > 0 ? overallSum / overallCount : 0,
  };
}

/** @deprecated Prefer {@link evaluateFogOfWarSearch}. */
export const evaluateExpandingSubgraphs = evaluateFogOfWarSearch;

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push('Synthetic graph fog-of-war evaluation');
  lines.push(
    `Corpus: ${report.corpus.works} works, ${report.corpus.tags} tags, ${report.corpus.authors} authors, ${report.corpus.communities} communities, ${report.corpus.seedCount} seeds`,
  );
  lines.push(`Policy: ${report.policy}`);
  lines.push(`K sweep: ${report.ks.join(', ')} (score = mean NDCG@K)`);
  lines.push(`Expansion budgets: ${report.depths.join(', ')}`);
  lines.push('');
  lines.push('Mean mean-NDCG by expansion budget (across seeds):');
  for (const depth of report.depths) {
    const value = report.meanNdcgByDepth[depth];
    if (value === undefined) {
      lines.push(`  budget ${depth}: (no seeds reached)`);
      continue;
    }
    lines.push(`  budget ${depth}: ${value.toFixed(4)}`);
  }
  lines.push(`Overall mean: ${report.overallMeanNdcg.toFixed(4)}`);
  lines.push('');

  for (const seed of report.seeds) {
    lines.push(
      `Seed ${seed.seedKey} (eccentricity ${seed.eccentricity}, gt works ${seed.groundTruthWorkCount}, expansions ${seed.expansionsCompleted})`,
    );
    for (const depth of seed.depths) {
      const perK = report.ks.map((k) => `@${k}=${depth.ndcgByK[k]!.toFixed(3)}`).join(' ');
      lines.push(
        `  b=${depth.depth} nodes=${depth.nodeCount} works=${depth.workCount} meanNDCG=${depth.meanNdcg.toFixed(4)} [${perK}]`,
      );
    }
  }

  return lines.join('\n');
}

export interface SeedPair {
  /** Seed used only to grow a partial fog graph (no NDCG). */
  conditionSeedKey: string;
  /** Query scored on the warm-started fog. */
  measureSeedKey: string;
}

export interface WarmStartEvaluateOptions {
  /** Conditioning budgets; partial graphs are forked here without scoring. */
  initialDepths?: readonly number[];
  /** Measurement budgets under the new query after warm-start. */
  depths?: readonly number[];
  ks?: readonly number[];
  /**
   * Ordered (condition, measure) pairs. Defaults to consecutive seeds in
   * `seedKeys` (wrapping), requiring at least two distinct keys.
   */
  seedPairs?: SeedPair[];
  /** Seed pool for default consecutive pairing; defaults to corpus.targetSeedKeys. */
  seedKeys?: string[];
  policy?: ExpansionPolicyKind | ExpansionPolicy;
}

export interface WarmStartDepthScore extends DepthScore {
  /** Visible nodes after conditioning, before measure-seed ensure-expand. */
  conditionedNodeCount: number;
  conditionedWorkCount: number;
  conditionedExploredCount: number;
}

export interface WarmStartPairEvaluation {
  conditionSeedKey: string;
  measureSeedKey: string;
  measureEccentricity: number;
  groundTruthWorkCount: number;
  /** Conditioning expansions completed for this pair's deepest fork. */
  conditioningExpansionsCompleted: number;
  /** Measurement expansions completed at the deepest initial budget. */
  measureExpansionsCompleted: number;
  byInitialDepth: Record<number, WarmStartDepthScore[]>;
}

export interface WarmStartEvaluationReport {
  corpus: EvaluationReport['corpus'];
  policy: string;
  ks: number[];
  initialDepths: number[];
  depths: number[];
  pairs: WarmStartPairEvaluation[];
  /**
   * Mean mean-NDCG across pairs, keyed by `initialDepth:measureDepth`.
   * Conditioning phase is excluded.
   */
  meanNdcgByInitialAndDepth: Record<string, number>;
  overallMeanNdcg: number;
}

export function warmStartCellKey(initialDepth: number, measureDepth: number): string {
  return `${initialDepth}:${measureDepth}`;
}

/** Consecutive wrap-around pairs over `seedKeys` (needs ≥2 distinct keys). */
export function consecutiveSeedPairs(seedKeys: string[]): SeedPair[] {
  const unique = [...new Set(seedKeys)];
  if (unique.length < 2) {
    throw new Error('Warm-start eval needs at least two distinct seed keys');
  }
  return unique.map((conditionSeedKey, index) => ({
    conditionSeedKey,
    measureSeedKey: unique[(index + 1) % unique.length]!,
  }));
}

function ensureSeedExpanded(fog: FogOfWar, seedIndex: number): void {
  if (!fog.explored.has(seedIndex)) {
    fog.expand(seedIndex);
  }
}

function exploreToBudget(
  fog: FogOfWar,
  policy: ExpansionPolicy,
  seedKey: string,
  budget: number,
  scoreAt: Set<number>,
  onCheckpoint: (expansionsDone: number, fog: FogOfWar) => void,
): number {
  let expansionsDone = 0;
  while (true) {
    if (scoreAt.has(expansionsDone)) {
      onCheckpoint(expansionsDone, fog);
    }
    if (expansionsDone >= budget) break;

    const observation = fog.observe(seedKey);
    const next = selectNextExpansion(fog, policy, observation);
    if (next == null) break;

    fog.expand(next);
    expansionsDone += 1;
  }
  return expansionsDone;
}

/**
 * Warm-start fog-of-war: grow a partial graph under a conditioning seed
 * (no NDCG), then score a different measure query from that fog at each
 * measurement expansion budget.
 */
export function evaluateWarmStartFogOfWarSearch(
  corpus: EvalCorpus,
  options: WarmStartEvaluateOptions = {},
): WarmStartEvaluationReport {
  const ks = [...(options.ks ?? DEFAULT_K_SWEEP)];
  const initialDepths = [...(options.initialDepths ?? DEFAULT_INITIAL_DEPTHS)].sort(
    (a, b) => a - b,
  );
  const measureDepths = [...(options.depths ?? DEFAULT_DEPTHS)].sort((a, b) => a - b);
  const seedKeys = options.seedKeys ?? corpus.targetSeedKeys;
  const seedPairs = options.seedPairs ?? consecutiveSeedPairs(seedKeys);
  const { policy, label: policyLabel } = resolvePolicy(options.policy);
  const maxInitial = initialDepths.length > 0 ? initialDepths[initialDepths.length - 1]! : 0;
  const maxMeasure = measureDepths.length > 0 ? measureDepths[measureDepths.length - 1]! : 0;
  const initialAt = new Set(initialDepths);
  const measureAt = new Set(measureDepths);

  const pairs: WarmStartPairEvaluation[] = [];
  const depthAccum = new Map<string, { sum: number; count: number }>();
  const workIndexSet = new Set(corpus.graph.csr!.workIndices);

  for (const { conditionSeedKey, measureSeedKey } of seedPairs) {
    if (conditionSeedKey === measureSeedKey) {
      throw new Error(
        `Warm-start pair must use distinct seeds (got ${conditionSeedKey} twice)`,
      );
    }

    const { gains, eccentricity } = bootstrapGroundTruth(corpus, measureSeedKey);
    const conditionIndex = corpus.graph.work(conditionSeedKey);
    const measureIndex = corpus.graph.work(measureSeedKey);
    const fog = FogOfWar.fromSeed(corpus.graph, conditionIndex);
    const byInitialDepth: Record<number, WarmStartDepthScore[]> = {};
    let conditioningExpansionsCompleted = 0;
    let measureExpansionsCompleted = 0;

    conditioningExpansionsCompleted = exploreToBudget(
      fog,
      policy,
      conditionSeedKey,
      maxInitial,
      initialAt,
      (initialDepth, conditioned) => {
        const snapshot = conditioned.clone();
        const conditionedNodeCount = snapshot.visible.size;
        const conditionedExploredCount = snapshot.explored.size;
        let conditionedWorkCount = 0;
        for (const index of snapshot.visible) {
          if (workIndexSet.has(index)) conditionedWorkCount += 1;
        }

        ensureSeedExpanded(snapshot, measureIndex);

        const depthScores: WarmStartDepthScore[] = [];
        const completed = exploreToBudget(
          snapshot,
          policy,
          measureSeedKey,
          maxMeasure,
          measureAt,
          (measureDepth, measureFog) => {
            const observation = measureFog.observe(measureSeedKey);
            const scored = scoreObservation(
              observation,
              measureSeedKey,
              gains,
              ks,
              measureDepth,
            );
            depthScores.push({
              ...scored,
              conditionedNodeCount,
              conditionedWorkCount,
              conditionedExploredCount,
            });
            const key = warmStartCellKey(initialDepth, measureDepth);
            const bucket = depthAccum.get(key) ?? { sum: 0, count: 0 };
            bucket.sum += scored.meanNdcg;
            bucket.count += 1;
            depthAccum.set(key, bucket);
          },
        );
        measureExpansionsCompleted = Math.max(measureExpansionsCompleted, completed);
        byInitialDepth[initialDepth] = depthScores;
      },
    );

    pairs.push({
      conditionSeedKey,
      measureSeedKey,
      measureEccentricity: eccentricity,
      groundTruthWorkCount: gains.size,
      conditioningExpansionsCompleted,
      measureExpansionsCompleted,
      byInitialDepth,
    });
  }

  const meanNdcgByInitialAndDepth: Record<string, number> = {};
  let overallSum = 0;
  let overallCount = 0;
  for (const [key, { sum, count }] of depthAccum) {
    meanNdcgByInitialAndDepth[key] = count > 0 ? sum / count : 0;
    overallSum += sum;
    overallCount += count;
  }

  const csr = corpus.graph.csr!;
  return {
    corpus: {
      communities: corpus.config.communities,
      works: corpus.workKeys.length,
      tags: csr.tagIndices.length,
      authors: csr.authorIndices.length,
      seedCount: seedPairs.length,
    },
    policy: policyLabel,
    ks,
    initialDepths,
    depths: measureDepths,
    pairs,
    meanNdcgByInitialAndDepth,
    overallMeanNdcg: overallCount > 0 ? overallSum / overallCount : 0,
  };
}

export function formatWarmStartEvaluationReport(report: WarmStartEvaluationReport): string {
  const lines: string[] = [];
  lines.push('Synthetic graph warm-start fog-of-war evaluation');
  lines.push(
    `Corpus: ${report.corpus.works} works, ${report.corpus.tags} tags, ${report.corpus.authors} authors, ${report.corpus.communities} communities, ${report.corpus.seedCount} pairs`,
  );
  lines.push(`Policy: ${report.policy}`);
  lines.push(`K sweep: ${report.ks.join(', ')} (score = mean NDCG@K on measure query only)`);
  lines.push(`Initial (conditioning) budgets: ${report.initialDepths.join(', ')}`);
  lines.push(`Measure budgets: ${report.depths.join(', ')}`);
  lines.push('');
  lines.push('Mean mean-NDCG by initial×measure budget (across pairs):');
  for (const initial of report.initialDepths) {
    for (const depth of report.depths) {
      const key = warmStartCellKey(initial, depth);
      const value = report.meanNdcgByInitialAndDepth[key];
      if (value === undefined) {
        lines.push(`  init=${initial} b=${depth}: (no pairs reached)`);
        continue;
      }
      lines.push(`  init=${initial} b=${depth}: ${value.toFixed(4)}`);
    }
  }
  lines.push(`Overall mean: ${report.overallMeanNdcg.toFixed(4)}`);
  lines.push('');

  for (const pair of report.pairs) {
    lines.push(
      `Pair ${pair.conditionSeedKey} → ${pair.measureSeedKey} (ecc ${pair.measureEccentricity}, gt works ${pair.groundTruthWorkCount}, condExp ${pair.conditioningExpansionsCompleted}, measExp ${pair.measureExpansionsCompleted})`,
    );
    for (const initial of report.initialDepths) {
      const depths = pair.byInitialDepth[initial] ?? [];
      for (const depth of depths) {
        const perK = report.ks.map((k) => `@${k}=${depth.ndcgByK[k]!.toFixed(3)}`).join(' ');
        lines.push(
          `  init=${initial} b=${depth.depth} condNodes=${depth.conditionedNodeCount} nodes=${depth.nodeCount} works=${depth.workCount} meanNDCG=${depth.meanNdcg.toFixed(4)} [${perK}]`,
        );
      }
    }
  }

  return lines.join('\n');
}
