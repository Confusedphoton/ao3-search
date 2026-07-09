import { runQueryPropagation } from '@/src/propagation';
import type { EvalCorpus } from './corpus';
import { meanNdcgAtKs, ndcgAtK } from './ndcg';
import { bfsDistances, extractDepthBall, maxFiniteDistance } from './subgraph';

export const DEFAULT_K_SWEEP = [5, 10, 20, 25, 50] as const;
export const DEFAULT_DEPTHS = [1, 2, 3, 4, 5] as const;

export interface EvaluateOptions {
  /** Search depths (hop radii) to evaluate. */
  depths?: readonly number[];
  /** NDCG cutoffs; reported score is the mean across these Ks. */
  ks?: readonly number[];
  /** Override seed work keys; defaults to corpus.targetSeedKeys. */
  seedKeys?: string[];
  /** Cap depths at the seed's eccentricity when true (default). */
  clampDepthToReachable?: boolean;
}

export interface DepthScore {
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
  ks: number[];
  depths: number[];
  seeds: SeedEvaluation[];
  /** Mean mean-NDCG across seeds, keyed by depth. */
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

/**
 * Full-graph bootstrap relevance as graded labels, then score expanding
 * open depth-balls with mean NDCG@K over a K sweep.
 */
export function evaluateExpandingSubgraphs(
  corpus: EvalCorpus,
  options: EvaluateOptions = {},
): EvaluationReport {
  const ks = [...(options.ks ?? DEFAULT_K_SWEEP)];
  const requestedDepths = [...(options.depths ?? DEFAULT_DEPTHS)];
  const seedKeys = options.seedKeys ?? corpus.targetSeedKeys;
  const clamp = options.clampDepthToReachable ?? true;

  const seeds: SeedEvaluation[] = [];
  const depthAccum = new Map<number, { sum: number; count: number }>();

  for (const seedKey of seedKeys) {
    const { gains, eccentricity } = bootstrapGroundTruth(corpus, seedKey);
    const seedIndex = corpus.graph.work(seedKey);
    const depthScores: DepthScore[] = [];

    const depths = clamp
      ? requestedDepths.filter((depth) => depth <= eccentricity)
      : requestedDepths;

    for (const depth of depths) {
      const { graph: subgraph } = extractDepthBall(corpus.graph, seedIndex, depth);
      const propagation = runQueryPropagation(
        subgraph.queryInput({ positive: { works: [seedKey] } }),
      );
      const predicted = rankedWorkKeysExcluding(
        subgraph,
        propagation.relevance,
        new Set([seedKey]),
      );

      const ndcgByK: Record<number, number> = {};
      for (const k of ks) {
        ndcgByK[k] = ndcgAtK(predicted, gains, k);
      }
      const meanNdcg = meanNdcgAtKs(predicted, gains, ks);

      depthScores.push({
        depth,
        nodeCount: subgraph.nodeCount,
        workCount: subgraph.workIndices.length,
        meanNdcg,
        ndcgByK,
      });

      const bucket = depthAccum.get(depth) ?? { sum: 0, count: 0 };
      bucket.sum += meanNdcg;
      bucket.count += 1;
      depthAccum.set(depth, bucket);
    }

    seeds.push({
      seedKey,
      eccentricity,
      groundTruthWorkCount: gains.size,
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
    ks,
    depths: requestedDepths,
    seeds,
    meanNdcgByDepth,
    overallMeanNdcg: overallCount > 0 ? overallSum / overallCount : 0,
  };
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push('Synthetic graph expanding-subgraph evaluation');
  lines.push(
    `Corpus: ${report.corpus.works} works, ${report.corpus.tags} tags, ${report.corpus.authors} authors, ${report.corpus.communities} communities, ${report.corpus.seedCount} seeds`,
  );
  lines.push(`K sweep: ${report.ks.join(', ')} (score = mean NDCG@K)`);
  lines.push(`Depths: ${report.depths.join(', ')}`);
  lines.push('');
  lines.push('Mean mean-NDCG by depth (across seeds):');
  for (const depth of report.depths) {
    const value = report.meanNdcgByDepth[depth];
    if (value === undefined) {
      lines.push(`  depth ${depth}: (no seeds reached)`);
      continue;
    }
    lines.push(`  depth ${depth}: ${value.toFixed(4)}`);
  }
  lines.push(`Overall mean: ${report.overallMeanNdcg.toFixed(4)}`);
  lines.push('');

  for (const seed of report.seeds) {
    lines.push(`Seed ${seed.seedKey} (eccentricity ${seed.eccentricity}, gt works ${seed.groundTruthWorkCount})`);
    for (const depth of seed.depths) {
      const perK = report.ks.map((k) => `@${k}=${depth.ndcgByK[k]!.toFixed(3)}`).join(' ');
      lines.push(
        `  d=${depth.depth} nodes=${depth.nodeCount} works=${depth.workCount} meanNDCG=${depth.meanNdcg.toFixed(4)} [${perK}]`,
      );
    }
  }

  return lines.join('\n');
}
