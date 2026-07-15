import type { NegativeSeed, PositiveSeed, SearchProgressPayload, SearchResultItem } from '../messaging/types';
import {
  EXPANSION_BUDGET,
  MIN_FRONTIER_EXPECTED_INFO,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';
import { loadSettings } from '../config/settings';
import {
  buildCSR,
  seedIndicesForNegativeSeeds,
  seedIndicesForPositiveSeeds,
  type CSRGraph,
} from '../graph/csr';
import { NodeKind } from '../graph/types';
import { workUrl } from '../ao3';
import { queryInputFromCsr } from '../propagation';
import { buildNodePermeabilities } from '../propagation/permeability';
import { runQueryPropagationViaWorker, closeComputeHost } from '../compute/host';
import { loadGraphSnapshot } from '../storage/db';
import { RequestHandler } from '../scheduler/requestHandler';
import { DefaultExpansionPolicy, type ExpansionPolicy } from './expansionPolicy';
import { buildFrontier } from './frontier';

export interface SearchRunResult {
  results: SearchResultItem[];
  requestsUsed: number;
}

export class SearchOrchestrator {
  private handler: RequestHandler;
  private policy: ExpansionPolicy;
  private cancelled = false;

  constructor(
    handler: RequestHandler = new RequestHandler(),
    policy: ExpansionPolicy = new DefaultExpansionPolicy(),
  ) {
    this.handler = handler;
    this.policy = policy;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(
    seeds: PositiveSeed[],
    negativeSeeds: NegativeSeed[],
    suppressedWorkIds: Iterable<string>,
    onProgress: (payload: SearchProgressPayload) => void | Promise<void>,
  ): Promise<SearchRunResult> {
    return this.runWithOptions(
      seeds,
      negativeSeeds,
      suppressedWorkIds,
      { continueFromRequests: 0 },
      onProgress,
    );
  }

  async continueRun(
    seeds: PositiveSeed[],
    negativeSeeds: NegativeSeed[],
    suppressedWorkIds: Iterable<string>,
    initialRequestsUsed: number,
    onProgress: (payload: SearchProgressPayload) => void | Promise<void>,
  ): Promise<SearchRunResult> {
    return this.runWithOptions(
      seeds,
      negativeSeeds,
      suppressedWorkIds,
      { continueFromRequests: initialRequestsUsed, forceExpand: true },
      onProgress,
    );
  }

  private async runWithOptions(
    seeds: PositiveSeed[],
    negativeSeeds: NegativeSeed[],
    suppressedWorkIds: Iterable<string>,
    options: { continueFromRequests: number; forceExpand?: boolean },
    onProgress: (payload: SearchProgressPayload) => void | Promise<void>,
  ): Promise<SearchRunResult> {
    this.cancelled = false;
    const continuing = options.continueFromRequests > 0;
    const forceExpand = options.forceExpand ?? false;
    const settings = await loadSettings();
    const { topResults, negativeRelevanceLambda, permeability } = settings;
    const positiveKeys = seeds.map((s) => {
      if (s.kind === 'work') return { kind: 'work' as const, key: s.workId };
      if (s.kind === 'tag') return { kind: 'tag' as const, key: s.tagName };
      return { kind: 'author' as const, key: s.authorKey };
    });
    const seedWorkIds = seeds.filter((s) => s.kind === 'work').map((s) => s.workId);
    const negativeKeys = negativeSeeds.map((s) => {
      if (s.kind === 'work') return { kind: 'work' as const, key: s.workId };
      if (s.kind === 'tag') return { kind: 'tag' as const, key: s.tagName };
      return { kind: 'author' as const, key: s.authorKey };
    });
    let requestsUsed = options.continueFromRequests;
    const expansionBudget = requestsUsed + EXPANSION_BUDGET;

    if (!continuing) {
      await onProgress({
        phase: 'cold-start',
        requestsUsed,
        expansionBudget,
        frontierSize: 0,
        message: 'Fetching seed nodes…',
      });

      const beforeSeeds = await loadGraphSnapshot();
      await this.handler.ensurePositiveSeeds(seeds);
      if (negativeSeeds.length > 0) {
        await onProgress({
          phase: 'cold-start',
          requestsUsed,
          expansionBudget,
          frontierSize: 0,
          message: 'Fetching negative seeds…',
        });
        await this.handler.ensureNegativeSeeds(negativeSeeds);
      }
      const afterSeeds = await loadGraphSnapshot();
      requestsUsed += countSeedFetches(beforeSeeds.nodes, afterSeeds.nodes);

      if (this.cancelled) {
        await closeComputeHost();
        return { results: [], requestsUsed };
      }
    } else {
      await onProgress({
        phase: 'expanding',
        requestsUsed,
        expansionBudget,
        frontierSize: 0,
        message: 'Continuing search — exploring beyond local optimum…',
      });
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
    const suppressedIds = new Set(suppressedWorkIds);

    const emitPreview = async (
      csr: CSRGraph,
      relevance: Float64Array | number[],
      payload: Omit<SearchProgressPayload, 'previewResults'>,
    ): Promise<void> => {
      await onProgress({
        ...payload,
        previewResults: rankWorks(
          csr,
          relevance,
          excludeWorkIds,
          suppressedIds,
          seedTitleMap,
          topResults,
        ),
      });
    };

    for (let expansion = 0; expansion < EXPANSION_BUDGET; expansion++) {
      if (this.cancelled) break;

      const snapshot = await loadGraphSnapshot();
      const csr = buildCSR(snapshot);
      const seedIndices = seedIndicesForPositiveSeeds(csr, positiveKeys);
      const negativeSeedIndices = seedIndicesForNegativeSeeds(csr, negativeKeys);

      if (seedIndices.length === 0) {
        await onProgress({
          phase: 'error',
          requestsUsed,
          expansionBudget,
          frontierSize: 0,
          message: 'No seed nodes found in graph.',
        });
        break;
      }

      await onProgress({
        phase: 'ranking',
        requestsUsed,
        expansionBudget,
        frontierSize: 0,
        message: 'Running Personalized PageRank…',
      });

      const nodePermeabilities = buildNodePermeabilities(csr.nodeByIndex, permeability);
      const propagation = await runQueryPropagationViaWorker({
        ...queryInputFromCsr(csr, {
          seedIndices,
          negativeSeedIndices,
          negativeLambda: negativeRelevanceLambda,
          nodePermeabilities,
          alpha: PPR_ALPHA,
          maxIterations: PPR_MAX_ITERATIONS,
          tolerance: PPR_TOLERANCE,
        }),
      });

      const relevance = Float64Array.from(propagation.relevance);
      const authority = Float64Array.from(propagation.authority);
      const precision = Float64Array.from(propagation.precision);
      const policyCtx = {
        csr,
        relevance,
        authority,
        precision,
        exploratory: forceExpand,
      };
      const frontier = this.policy.buildFrontier(policyCtx);

      await emitPreview(csr, relevance, {
        phase: expansion === 0 && !continuing ? 'ranking' : 'expanding',
        requestsUsed,
        expansionBudget,
        frontierSize: frontier.length,
        message:
          expansion === 0 && !continuing
            ? 'Initial estimate'
            : continuing && expansion === 0
              ? 'Refining results'
              : 'Updating ranking',
      });

      if (frontier.length === 0) break;
      if (!forceExpand && this.policy.maxExpectedInfo(frontier) < MIN_FRONTIER_EXPECTED_INFO) break;

      const plan = this.policy.selectNext(policyCtx);
      if (!plan) break;

      const outcome = await this.handler.execute(plan);
      requestsUsed += outcome.requestCount;

      if (this.cancelled) break;
    }

    const finalSnapshot = await loadGraphSnapshot();
    const finalCsr = buildCSR(finalSnapshot);
    const finalSeeds = seedIndicesForPositiveSeeds(finalCsr, positiveKeys);
    const finalNegativeSeeds = seedIndicesForNegativeSeeds(finalCsr, negativeKeys);
    const finalNodePermeabilities = buildNodePermeabilities(
      finalCsr.nodeByIndex,
      permeability,
    );
    const finalPropagation = await runQueryPropagationViaWorker({
      ...queryInputFromCsr(finalCsr, {
        seedIndices: finalSeeds,
        negativeSeedIndices: finalNegativeSeeds,
        negativeLambda: negativeRelevanceLambda,
        nodePermeabilities: finalNodePermeabilities,
        alpha: PPR_ALPHA,
        maxIterations: PPR_MAX_ITERATIONS,
        tolerance: PPR_TOLERANCE,
      }),
    });

    await closeComputeHost();

    const relevance = Float64Array.from(finalPropagation.relevance);
    const results = rankWorks(
      finalCsr,
      relevance,
      excludeWorkIds,
      suppressedIds,
      seedTitleMap,
      topResults,
    );
    const finalAuthority = Float64Array.from(finalPropagation.authority);
    const finalPrecision = Float64Array.from(finalPropagation.precision);
    const remainingFrontier = buildFrontier(finalCsr, relevance, finalAuthority, finalPrecision);

    await onProgress({
      phase: 'done',
      requestsUsed,
      expansionBudget,
      frontierSize: remainingFrontier.length,
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
  relevance: Float64Array | number[],
  excludeWorkIds: Set<string>,
  suppressedWorkIds: Set<string>,
  seedTitleMap: Map<string, string>,
  topResults: number,
): SearchResultItem[] {
  const ranked = csr.workIndices
    .map((index) => ({
      node: csr.nodeByIndex[index],
      score: relevance[index],
    }))
    .filter((item) => item.node.kind === NodeKind.Work && !excludeWorkIds.has(item.node.key))
    .sort((a, b) => b.score - a.score);

  const results: SearchResultItem[] = [];
  let visibleCount = 0;
  for (const item of ranked) {
    const suppressed = suppressedWorkIds.has(item.node.key);
    if (!suppressed) visibleCount++;
    results.push({
      workId: item.node.key,
      title: resolveWorkTitle(item.node.key, item.node.title, seedTitleMap),
      url: workUrl(item.node.key),
      relevance: item.score,
    });
    if (visibleCount >= topResults) break;
  }
  return results;
}

/** Count nodes that gained/changed exploredAt during seed ensure (≈ HTTP fetches). */
function countSeedFetches(
  before: { id: number; exploredAt: number | null }[],
  after: { id: number; exploredAt: number | null }[],
): number {
  const beforeMap = new Map(before.map((n) => [n.id, n.exploredAt]));
  let count = 0;
  for (const node of after) {
    const prev = beforeMap.get(node.id);
    if (node.exploredAt != null && prev !== node.exploredAt) {
      count += 1;
    }
  }
  return count;
}
