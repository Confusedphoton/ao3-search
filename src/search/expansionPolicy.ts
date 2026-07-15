import type { CSRGraph } from '../graph/csr';
import { isExpandable } from '../graph/exploration';
import { NodeKind } from '../graph/types';
import type { FetchPlan } from '../scheduler/types';
import { MIN_FRONTIER_EXPECTED_INFO } from '../config/constants';
import {
  buildFrontier,
  maxFrontierExpectedInfo,
  pickNextFrontier,
  type FrontierNode,
} from './frontier';
import type { TopologyInvariants } from './topology/orderComplex';
import { TopologicalExpansionPolicy } from './topology/TopologicalExpansionPolicy';

export interface ExpansionPolicyContext {
  csr: CSRGraph;
  relevance: Float64Array;
  authority: Float64Array;
  precision: Float64Array;
  /** Open-subgraph row fractions; defaults to `csr.rowOutFractions`. */
  rowOutFractions?: Float64Array;
  exploratory?: boolean;
  now?: number;
}

export interface ExpansionPolicy {
  /** Early-stop threshold for `maxAcquisitionScore`. */
  readonly minAcquisitionScore: number;
  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[];
  selectNext(ctx: ExpansionPolicyContext): FetchPlan | null;
  maxExpectedInfo(frontier: FrontierNode[]): number;
  maxAcquisitionScore(frontier: FrontierNode[]): number;
  /** Present on topological policy after `buildFrontier`. */
  topologySnapshot?(): TopologyInvariants | null;
}

/** ε-greedy expected-info policy with pagination + stale complete rechecks. */
export class DefaultExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_EXPECTED_INFO;

  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[] {
    return buildFrontier(ctx.csr, ctx.relevance, ctx.authority, ctx.precision, ctx.now);
  }

  selectNext(ctx: ExpansionPolicyContext): FetchPlan | null {
    const frontier = this.buildFrontier(ctx);
    const picked = pickNextFrontier(frontier, { exploratory: ctx.exploratory });
    if (!picked) return null;
    return planForNode(ctx.csr, picked.index);
  }

  maxExpectedInfo(frontier: FrontierNode[]): number {
    return maxFrontierExpectedInfo(frontier);
  }

  maxAcquisitionScore(frontier: FrontierNode[]): number {
    return this.maxExpectedInfo(frontier);
  }
}

export function planForNode(csr: CSRGraph, index: number): FetchPlan | null {
  const node = csr.nodeByIndex[index];
  if (!node) return null;

  if (node.kind === NodeKind.Work) {
    return { type: 'work', workId: node.key, marksNodeId: node.id };
  }

  if (node.kind === NodeKind.Author) {
    const page =
      node.explorationStatus === 'complete' ? 1 : (node.listingNextPage ?? 1);
    return {
      type: 'authorListing',
      authorKey: node.key,
      page,
      marksNodeId: node.id,
    };
  }

  const page =
    node.explorationStatus === 'complete' ? 1 : (node.listingNextPage ?? 1);
  return {
    type: 'tagListing',
    tagName: node.key,
    page,
    marksNodeId: node.id,
  };
}

export function isNodeExpandable(
  csr: CSRGraph,
  index: number,
  now = Date.now(),
): boolean {
  const node = csr.nodeByIndex[index];
  return node ? isExpandable(node, now) : false;
}

export type ExpansionPolicyKind = 'expected-info' | 'topological';

export function createExpansionPolicy(kind: ExpansionPolicyKind): ExpansionPolicy {
  if (kind === 'topological') return new TopologicalExpansionPolicy();
  return new DefaultExpansionPolicy();
}
