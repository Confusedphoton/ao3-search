import { MIN_FRONTIER_QUERY_SCORE, QUERY_ASTAR_MAX_THINK_MS } from '../../config/constants';
import type { FrontierNode } from '../frontier';
import type {
  ExpansionAction,
  ExpansionPolicy,
  ExpansionPolicyContext,
} from '../expansionPolicy';
import {
  frontierFromFragility,
  type TopologicalPolicyState,
} from './TopologicalExpansionPolicy';
import { runQueryAStar } from './queryAStar';
import { pipelineToQueryContext } from './queryState';
import { runTopologyPipeline } from './topologyPipeline';
import type { TopologyInvariants } from './orderComplex';

/**
 * Fragility-guided iterative-deepening A* over node expand/requery and
 * `/works/search` query construction.
 *
 * Uses a wall-clock think budget per propose(). If thinking finishes before the
 * AO3 request delay elapses, the rate limiter sits idle until a request can be
 * made; if the budget is longer than the delay, A* keeps improving for the full
 * allotment before the next fetch.
 */
export class TopologicalQueryExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_QUERY_SCORE;

  private lastState: TopologicalPolicyState | null = null;
  private lastAStarDepth = 0;
  private readonly maxThinkMs: number;

  constructor(maxThinkMs: number = QUERY_ASTAR_MAX_THINK_MS) {
    this.maxThinkMs = Math.max(0, maxThinkMs);
  }

  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[] {
    const pipeline = runTopologyPipeline(ctx);
    this.lastState = {
      topology: pipeline.topology,
      hypothesisCount: pipeline.hypotheses.length,
      posetHeight: pipeline.poset.height,
      posetWidth: pipeline.poset.width,
    };
    return frontierFromFragility(ctx, pipeline.fragility);
  }

  propose(ctx: ExpansionPolicyContext, _frontier?: FrontierNode[]): ExpansionAction | null {
    const pipeline = runTopologyPipeline(ctx);
    this.lastState = {
      topology: pipeline.topology,
      hypothesisCount: pipeline.hypotheses.length,
      posetHeight: pipeline.poset.height,
      posetWidth: pipeline.poset.width,
    };
    const queryCtx = pipelineToQueryContext(
      ctx.csr,
      ctx.relevance,
      pipeline,
      ctx.now ?? Date.now(),
      ctx.tagTypes,
    );
    queryCtx.maxThinkMs = this.maxThinkMs;
    const result = runQueryAStar(queryCtx);
    this.lastAStarDepth = result.depthReached;
    return result.action;
  }

  maxExpectedInfo(frontier: FrontierNode[]): number {
    let max = 0;
    for (const node of frontier) max = Math.max(max, node.expectedInfo);
    return max;
  }

  maxAcquisitionScore(frontier: FrontierNode[]): number {
    if (frontier.length === 0) return 0;
    return frontier[0]?.score ?? frontier[0]?.expectedInfo ?? 0;
  }

  topologySnapshot(): TopologyInvariants | null {
    return this.lastState?.topology ?? null;
  }

  policyState(): TopologicalPolicyState | null {
    return this.lastState;
  }

  lastQueryDepth(): number {
    return this.lastAStarDepth;
  }
}
