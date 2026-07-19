import { MIN_FRONTIER_FRAGILITY, PRECISION_EPS } from '../../config/constants';
import { isExpandable } from '../../graph/exploration';
import type { FrontierNode } from '../frontier';
import {
  planForNode,
  type ExpansionAction,
  type ExpansionPolicy,
  type ExpansionPolicyContext,
} from '../expansionPolicy';
import { runTopologyPipeline, type TopologyPipelineResult } from './topologyPipeline';
import type { TopologyInvariants } from './orderComplex';

export interface TopologicalPolicyState {
  topology: TopologyInvariants;
  hypothesisCount: number;
  posetHeight: number;
  posetWidth: number;
}

function frontierFromFragility(
  ctx: ExpansionPolicyContext,
  fragility: Float64Array,
): FrontierNode[] {
  const now = ctx.now ?? Date.now();
  const frontier: FrontierNode[] = [];
  for (let index = 0; index < ctx.csr.nodeByIndex.length; index++) {
    const node = ctx.csr.nodeByIndex[index]!;
    if (!isExpandable(node, now)) continue;
    const rel = ctx.relevance[index] ?? 0;
    const auth = ctx.authority[index] ?? 0;
    const prec = ctx.precision[index] ?? 0;
    const score = fragility[index] ?? 0;
    const expectedInfo = (rel * auth) / (prec + PRECISION_EPS);
    frontier.push({
      nodeId: node.id,
      index,
      relevance: rel,
      authority: auth,
      precision: prec,
      expectedInfo,
      score,
    });
  }
  return frontier.sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    return scoreDelta !== 0 ? scoreDelta : b.expectedInfo - a.expectedInfo;
  });
}

/**
 * Ranks expandable nodes by topological fragility
 * (boundary exposure × potential influence). Stopping is owned by the caller.
 */
export class TopologicalExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_FRAGILITY;

  private lastState: TopologicalPolicyState | null = null;

  protected rememberPipeline(pipeline: TopologyPipelineResult): void {
    this.lastState = {
      topology: pipeline.topology,
      hypothesisCount: pipeline.hypotheses.length,
      posetHeight: pipeline.poset.height,
      posetWidth: pipeline.poset.width,
    };
  }

  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[] {
    const pipeline = runTopologyPipeline(ctx);
    this.rememberPipeline(pipeline);
    return frontierFromFragility(ctx, pipeline.fragility);
  }

  propose(ctx: ExpansionPolicyContext, frontier?: FrontierNode[]): ExpansionAction | null {
    const ranked = frontier ?? this.buildFrontier(ctx);
    if (ranked.length === 0) return null;
    const best = ranked[0]!;
    const plan = planForNode(ctx.csr, best.index);
    if (!plan) {
      throw new Error(`No fetch plan for expandable node index ${best.index}`);
    }
    return {
      plan,
      score: best.score ?? best.expectedInfo,
      meta: { depth: 0, kind: 'node' },
    };
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
}

export { frontierFromFragility };
