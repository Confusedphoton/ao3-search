import { MIN_FRONTIER_FRAGILITY, PRECISION_EPS } from '../../config/constants';
import { isExpandable } from '../../graph/exploration';
import type { FrontierNode } from '../frontier';
import type { ExpansionPolicy, ExpansionPolicyContext } from '../expansionPolicy';
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
 * Ranks expandable nodes by topological fragility
 * (boundary exposure × potential influence). Stopping is owned by the caller.
 */
export class TopologicalExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_FRAGILITY;

  private lastState: TopologicalPolicyState | null = null;

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
