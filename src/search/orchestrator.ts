import type { SeedWork, SearchProgressPayload, SearchResultItem } from '../messaging/types';
import {
  EXPANSION_BUDGET,
  MIN_FRONTIER_AUTHORITY,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
  TOP_RESULTS,
} from '../config/constants';
import { buildCSR, seedIndicesForWorks } from '../graph/csr';
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
    seeds: SeedWork[],
    onProgress: (payload: SearchProgressPayload) => void,
  ): Promise<SearchRunResult> {
    this.cancelled = false;
    const seedIds = seeds.map((s) => s.workId);
    let requestsUsed = 0;

    onProgress({
      phase: 'cold-start',
      requestsUsed,
      expansionBudget: EXPANSION_BUDGET,
      frontierSize: 0,
      message: 'Fetching seed works…',
    });

    const beforeSeeds = await loadGraphSnapshot();
    await this.scheduler.ensureSeedWorks(seedIds);
    const afterSeeds = await loadGraphSnapshot();
    requestsUsed += countNewlyExplored(beforeSeeds.nodes, afterSeeds.nodes);

    if (this.cancelled) {
      await closeComputeHost();
      return { results: [], requestsUsed };
    }

    for (let expansion = 0; expansion < EXPANSION_BUDGET; expansion++) {
      if (this.cancelled) break;

      const snapshot = await loadGraphSnapshot();
      const csr = buildCSR(snapshot);
      const seedIndices = seedIndicesForWorks(csr, seedIds);

      if (seedIndices.length === 0) {
        onProgress({
          phase: 'error',
          requestsUsed,
          expansionBudget: EXPANSION_BUDGET,
          frontierSize: 0,
          message: 'No seed works found in graph.',
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
        alpha: PPR_ALPHA,
        maxIterations: PPR_MAX_ITERATIONS,
        tolerance: PPR_TOLERANCE,
      });

      const authority = Float64Array.from(ppr.authority);
      const frontier = buildFrontier(csr, authority);

      onProgress({
        phase: 'expanding',
        requestsUsed,
        expansionBudget: EXPANSION_BUDGET,
        frontierSize: frontier.length,
        message: `Frontier size: ${frontier.length}`,
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
    const finalSeeds = seedIndicesForWorks(finalCsr, seedIds);
    const finalPpr = await runPPRViaWorker({
      offsets: finalCsr.offsets,
      neighbors: finalCsr.neighbors,
      edgeWeights: finalCsr.edgeWeights,
      seedIndices: finalSeeds,
      alpha: PPR_ALPHA,
      maxIterations: PPR_MAX_ITERATIONS,
      tolerance: PPR_TOLERANCE,
    });

    await closeComputeHost();

    const authority = Float64Array.from(finalPpr.authority);
    const seedSet = new Set(seedIds);
    const results: SearchResultItem[] = [];

    const ranked = finalCsr.workIndices
      .map((index) => ({
        index,
        node: finalCsr.nodeByIndex[index],
        score: authority[index],
      }))
      .filter((item) => !seedSet.has(item.node.key))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_RESULTS);

    for (const item of ranked) {
      if (item.node.kind !== NodeKind.Work) continue;
      results.push({
        workId: item.node.key,
        title: item.node.title ?? `Work ${item.node.key}`,
        url: workUrl(item.node.key),
        authority: item.score,
      });
    }

    onProgress({
      phase: 'done',
      requestsUsed,
      expansionBudget: EXPANSION_BUDGET,
      frontierSize: 0,
      message: `Found ${results.length} works`,
    });

    return { results, requestsUsed };
  }
}

function countNewlyExplored(before: { explored: boolean }[], after: { explored: boolean }[]): number {
  const beforeExplored = before.filter((n) => n.explored).length;
  const afterExplored = after.filter((n) => n.explored).length;
  return Math.max(0, afterExplored - beforeExplored);
}
