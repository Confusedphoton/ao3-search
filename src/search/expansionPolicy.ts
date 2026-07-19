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
import { TopologicalQueryExpansionPolicy } from './topology/TopologicalQueryExpansionPolicy';

export interface ExpansionPolicyContext {
  csr: CSRGraph;
  relevance: Float64Array;
  authority: Float64Array;
  precision: Float64Array;
  /** Open-subgraph row fractions; defaults to `csr.rowOutFractions`. */
  rowOutFractions?: Float64Array;
  now?: number;
  /** When true, ε-greedy policies explore randomly (e.g. continue-search). */
  exploratory?: boolean;
  /** Optional AO3 stats-dump tag type by tag name (Fandom, Character, …). */
  tagTypes?: ReadonlyMap<string, string>;
}

/** Next fetch chosen by a policy; score drives owner early-stop. */
export interface ExpansionAction {
  plan: FetchPlan;
  score: number;
  meta?: { depth: number; kind: 'node' | 'worksSearch' };
}

/**
 * Ranks expandable nodes and proposes the next fetch. Owners
 * (orchestrator, eval loop) apply budget / score / stability stops.
 *
 * `buildFrontier` must include every expandable node and may only be empty
 * when the graph is fully explored.
 */
export interface ExpansionPolicy {
  /** Owner early-stop threshold for `maxAcquisitionScore` (not used by the policy itself). */
  readonly minAcquisitionScore: number;
  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[];
  /**
   * Current-best fetch action under this policy.
   * When `frontier` is passed (from a prior `buildFrontier` on the same ctx),
   * policies that rank nodes should reuse it so ε-greedy / scores stay consistent.
   */
  propose(ctx: ExpansionPolicyContext, frontier?: FrontierNode[]): ExpansionAction | null;
  maxExpectedInfo(frontier: FrontierNode[]): number;
  maxAcquisitionScore(frontier: FrontierNode[]): number;
  /** Present on topological policies after `buildFrontier` / `propose`. */
  topologySnapshot?(): TopologyInvariants | null;
}

/**
 * Best fetch plan for a scored frontier.
 * Returns null only when `frontier` is empty (fully explored).
 */
export function selectNextPlan(
  csr: CSRGraph,
  frontier: FrontierNode[],
  options: { exploratory?: boolean } = {},
): FetchPlan | null {
  if (frontier.length === 0) return null;
  const picked = pickNextFrontier(frontier, options);
  if (!picked) return null;
  const plan = planForNode(csr, picked.index);
  if (!plan) {
    throw new Error(`No fetch plan for expandable node index ${picked.index}`);
  }
  return plan;
}

/** ε-greedy expected-info ranking with pagination + stale complete rechecks. */
export class DefaultExpansionPolicy implements ExpansionPolicy {
  readonly minAcquisitionScore = MIN_FRONTIER_EXPECTED_INFO;

  buildFrontier(ctx: ExpansionPolicyContext): FrontierNode[] {
    return buildFrontier(ctx.csr, ctx.relevance, ctx.authority, ctx.precision, ctx.now);
  }

  propose(ctx: ExpansionPolicyContext, frontier?: FrontierNode[]): ExpansionAction | null {
    const ranked = frontier ?? this.buildFrontier(ctx);
    if (ranked.length === 0) return null;
    const picked = pickNextFrontier(ranked, { exploratory: ctx.exploratory });
    if (!picked) return null;
    const plan = planForNode(ctx.csr, picked.index);
    if (!plan) {
      throw new Error(`No fetch plan for expandable node index ${picked.index}`);
    }
    return {
      plan,
      score: picked.score ?? picked.expectedInfo,
      meta: { depth: 0, kind: 'node' },
    };
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

export type ExpansionPolicyKind = 'expected-info' | 'topological' | 'topo-query';

export interface ExpansionPolicyOptions {
  /** Wall-clock budget for topo-query A* (ms). Ignored by other policies. */
  queryAStarMaxThinkMs?: number;
}

export function createExpansionPolicy(
  kind: ExpansionPolicyKind,
  options: ExpansionPolicyOptions = {},
): ExpansionPolicy {
  if (kind === 'topological') return new TopologicalExpansionPolicy();
  if (kind === 'topo-query') {
    return new TopologicalQueryExpansionPolicy(options.queryAStarMaxThinkMs);
  }
  return new DefaultExpansionPolicy();
}
