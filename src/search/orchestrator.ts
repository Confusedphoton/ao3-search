import type { NegativeSeed, PositiveSeed, SearchProgressPayload, SearchResultItem } from '../messaging/types';
import {
  EXPANSION_BUDGET,
  MIN_FRONTIER_AUTHORITY,
  NEGATIVE_SEED_WEIGHT,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
  TOP_RESULTS,
} from '../config/constants';
import {
  buildCSR,
  seedIndicesForNegativeSeeds,
  seedIndicesForPositiveSeeds,
  type CSRGraph,
} from '../graph/csr';
import { NodeKind } from '../graph/types';
import { workUrl } from '../ao3';
import { runPPRViaWorker, closeComputeHost } from '../compute/host';
import { loadGraphSnapshot } from '../storage/db';
import { RequestScheduler } from '../scheduler/scheduler';
import { buildFrontier, maxFrontierAuthority, pickNextFrontier } from './frontier';

export interface SearchRunResult {
  results: SearchResultItem[];
  requestsUsed: number;
}

export class SearchOrchestrator {
  private scheduler = new RequestScheduler();
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  async run(
    seeds: PositiveSeed[],
    negativeSeeds: NegativeSeed[],
    onProgress: (payload: SearchProgressPayload) => void,
  ): Promise<SearchRunResult> {
    this.cancelled = false;
    const positiveKeys = seeds.map((s) =>
      s.kind === 'work' ? { kind: 'work' as const, key: s.workId } : { kind: 'tag' as const, key: s.tagName },
    );
    const seedWorkIds = seeds.filter((s) => s.kind === 'work').map((s) => s.workId);
    const negativeKeys = negativeSeeds.map((s) =>
      s.kind === 'work' ? { kind: 'work' as const, key: s.workId } : { kind: 'tag' as const, key: s.tagName },
    );
    let requestsUsed = 0;

    onProgress({
      phase: 'cold-start',
      requestsUsed,
      expansionBudget: EXPANSION_BUDGET,
      frontierSize: 0,
      message: 'Fetching seed nodes…',
    });

    const beforeSeeds = await loadGraphSnapshot();
    await this.scheduler.ensurePositiveSeeds(seeds);
    if (negativeSeeds.length > 0) {
      onProgress({
        phase: 'cold-start',
        requestsUsed,
        expansionBudget: EXPANSION_BUDGET,
        frontierSize: 0,
        message: 'Fetching negative seeds…',
      });
      await this.scheduler.ensureNegativeSeeds(negativeSeeds);
    }
    const afterSeeds = await loadGraphSnapshot();
    requestsUsed += countNewlyExplored(beforeSeeds.nodes, afterSeeds.nodes);

    if (this.cancelled) {
      await closeComputeHost();
      return { results: [], requestsUsed };
    }

    const seedTitleMap = new Map<string, string>();
    for (const seed of seeds) {
      if (seed.kind === 'work' && !isPlaceholderWorkTitle(seed.workId, seed.title)) {
        seedTitleMap.set(seed.workId, seed.title);
      }
    }

    const excludeWorkIds = new Set(seedWorkIds);
    for (const seed of negativeSeeds) {
      if (seed.kind === 'work') excludeWorkIds.add(seed.workId);
    }

    const emitPreview = (
      csr: CSRGraph,
      authority: Float64Array | number[],
      payload: Omit<SearchProgressPayload, 'previewResults'>,
    ): void => {
      onProgress({
        ...payload,
        previewResults: rankWorks(csr, authority, excludeWorkIds, seedTitleMap),
      });
    };

    for (let expansion = 0; expansion < EXPANSION_BUDGET; expansion++) {
      if (this.cancelled) break;

      const snapshot = await loadGraphSnapshot();
      const csr = buildCSR(snapshot);
      const seedIndices = seedIndicesForPositiveSeeds(csr, positiveKeys);
      const negativeSeedIndices = seedIndicesForNegativeSeeds(csr, negativeKeys);

      if (seedIndices.length === 0) {
        onProgress({
          phase: 'error',
          requestsUsed,
          expansionBudget: EXPANSION_BUDGET,
          frontierSize: 0,
          message: 'No seed nodes found in graph.',
        });
        break;
      }

      onProgress({
        phase: 'ranking',
        requestsUsed,
        expansionBudget: EXPANSION_BUDGET,
        frontierSize: 0,
        message: 'Running Personalized PageRank…',
      });

      const ppr = await runPPRViaWorker({
        offsets: csr.offsets,
        neighbors: csr.neighbors,
        edgeWeights: csr.edgeWeights,
        seedIndices,
        negativeSeedIndices,
        negativeWeight: NEGATIVE_SEED_WEIGHT,
        alpha: PPR_ALPHA,
        maxIterations: PPR_MAX_ITERATIONS,
        tolerance: PPR_TOLERANCE,
      });

      const authority = Float64Array.from(ppr.authority);
      const frontier = buildFrontier(csr, authority);

      emitPreview(csr, authority, {
        phase: expansion === 0 ? 'ranking' : 'expanding',
        requestsUsed,
        expansionBudget: EXPANSION_BUDGET,
        frontierSize: frontier.length,
        message: expansion === 0 ? 'Initial estimate' : 'Updating ranking',
      });

      if (frontier.length === 0) break;
      if (maxFrontierAuthority(frontier) < MIN_FRONTIER_AUTHORITY) break;

      const next = pickNextFrontier(frontier);
      if (!next) break;

      const node = csr.nodeByIndex[next.index];
      await this.scheduler.expandNode(node);
      requestsUsed++;

      if (this.cancelled) break;
    }

    const finalSnapshot = await loadGraphSnapshot();
    const finalCsr = buildCSR(finalSnapshot);
    const finalSeeds = seedIndicesForPositiveSeeds(finalCsr, positiveKeys);
    const finalNegativeSeeds = seedIndicesForNegativeSeeds(finalCsr, negativeKeys);
    const finalPpr = await runPPRViaWorker({
      offsets: finalCsr.offsets,
      neighbors: finalCsr.neighbors,
      edgeWeights: finalCsr.edgeWeights,
      seedIndices: finalSeeds,
      negativeSeedIndices: finalNegativeSeeds,
      negativeWeight: NEGATIVE_SEED_WEIGHT,
      alpha: PPR_ALPHA,
      maxIterations: PPR_MAX_ITERATIONS,
      tolerance: PPR_TOLERANCE,
    });

    await closeComputeHost();

    const authority = Float64Array.from(finalPpr.authority);
    const results = rankWorks(finalCsr, authority, excludeWorkIds, seedTitleMap);

    onProgress({
      phase: 'done',
      requestsUsed,
      expansionBudget: EXPANSION_BUDGET,
      frontierSize: 0,
      message: `Found ${results.length} works`,
      previewResults: results,
    });

    return { results, requestsUsed };
  }
}

function isPlaceholderWorkTitle(workId: string, title: string | undefined): boolean {
  return !title || title === `Work ${workId}`;
}

function resolveWorkTitle(
  workId: string,
  graphTitle: string | undefined,
  seedTitleMap: Map<string, string>,
): string {
  if (graphTitle && !isPlaceholderWorkTitle(workId, graphTitle)) return graphTitle;
  const seedTitle = seedTitleMap.get(workId);
  if (seedTitle && !isPlaceholderWorkTitle(workId, seedTitle)) return seedTitle;
  return graphTitle ?? `Work ${workId}`;
}

function rankWorks(
  csr: CSRGraph,
  authority: Float64Array | number[],
  excludeWorkIds: Set<string>,
  seedTitleMap: Map<string, string>,
): SearchResultItem[] {
  return csr.workIndices
    .map((index) => ({
      node: csr.nodeByIndex[index],
      score: authority[index],
    }))
    .filter((item) => item.node.kind === NodeKind.Work && !excludeWorkIds.has(item.node.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_RESULTS)
    .map((item) => ({
      workId: item.node.key,
      title: resolveWorkTitle(item.node.key, item.node.title, seedTitleMap),
      url: workUrl(item.node.key),
      authority: item.score,
    }));
}

function countNewlyExplored(before: { explored: boolean }[], after: { explored: boolean }[]): number {
  const beforeExplored = before.filter((n) => n.explored).length;
  const afterExplored = after.filter((n) => n.explored).length;
  return Math.max(0, afterExplored - beforeExplored);
}
