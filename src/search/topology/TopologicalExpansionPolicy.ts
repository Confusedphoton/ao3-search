import { MIN_FRONTIER_FRAGILITY } from '../../config/constants';
import { isExpandable } from '../../graph/exploration';
import type { FetchPlan } from '../../scheduler/types';
import {
  pickNextFrontier,
  type FrontierNode,
} from '../frontier';
import {
  planForNode,
  type ExpansionPolicy,
  type ExpansionPolicyContext,
} from '../expansionPolicy';
import { extractNeighborhoods } from './neighborhoods';
import { buildHypothesisPoset } from './poset';
import {
  computeHasseHomology,
  type TopologyInvariants,
} from './orderComplex';
import { computeFragilityAll } from './fragility';

export interface TopologicalPolicyState {
  topology: TopologyInvariants;
  hypothesisCount: number;
  posetHeight: number;
  posetWidth: number;
}

/**
 * Expansion policy that selects nodes by topological fragility
 * (boundary exposure × potential influence), using the hypothesis
 * refinement poset built from conductance superlevel neighborhoods.
 */
export class TopologicalExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_FRAGILITY;

  private lastState: TopologicalPolicyState | null = null;
  private cachedFrontier: FrontierNode[] | null = null;

  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[] {
    const rowOut = ctx.rowOutFractions ?? ctx.csr.rowOutFractions;
    const extraction = extractNeighborhoods(ctx.csr, ctx.relevance, ctx.authority, {
      rowOutFractions: rowOut,
    });
    const poset = buildHypothesisPoset(extraction.hypotheses);
    const topology = computeHasseHomology(poset);
    this.lastState = {
      topology,
      hypothesisCount: extraction.hypotheses.length,
      posetHeight: poset.height,
      posetWidth: poset.width,
    };

    const fragility = computeFragilityAll({
      csr: ctx.csr,
      field: extraction.field,
      hypotheses: extraction.hypotheses,
      poset,
      topology,
      rowOutFractions: rowOut,
    });

    const now = ctx.now ?? Date.now();
    const frontier: FrontierNode[] = [];
    for (let index = 0; index < ctx.csr.nodeByIndex.length; index++) {
      const node = ctx.csr.nodeByIndex[index]!;
      if (!isExpandable(node, now)) continue;
      const rel = ctx.relevance[index] ?? 0;
      const auth = ctx.authority[index] ?? 0;
      const prec = ctx.precision[index] ?? 0;
      const score = fragility[index] ?? 0;
      frontier.push({
        nodeId: node.id,
        index,
        relevance: rel,
        authority: auth,
        precision: prec,
        expectedInfo: score,
        score,
      });
    }
    const sorted = frontier.sort(
      (a, b) => (b.score ?? b.expectedInfo) - (a.score ?? a.expectedInfo),
    );
    this.cachedFrontier = sorted;
    return sorted;
  }

  selectNext(ctx: ExpansionPolicyContext): FetchPlan | null {
    const frontier = this.cachedFrontier ?? this.buildFrontier(ctx);
    this.cachedFrontier = null;
    const picked = pickNextFrontier(frontier, { exploratory: ctx.exploratory });
    if (!picked) return null;
    return planForNode(ctx.csr, picked.index);
  }

  maxExpectedInfo(frontier: FrontierNode[]): number {
    return this.maxAcquisitionScore(frontier);
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
