import type { CSRGraph } from '@/src/graph/csr';
import type { ExpansionAction, ExpansionPolicy } from '@/src/search/expansionPolicy';
import { NodeKind } from '@/src/graph/types';
import { runQueryPropagation } from '@/src/propagation';
import { SyntheticGraph } from '../../tests/fixtures/syntheticGraph';
import { FOG_MATERIALIZE_EXPLORED_AT, induceVisibleSubgraph } from './subgraph';

export interface FogObservation {
  subgraph: SyntheticGraph;
  relevance: Float64Array;
  authority: Float64Array;
  precision: Float64Array;
}

/**
 * Fog-of-war exploration over a closed parent graph.
 * Expanding a node reveals its full neighborhood; only explored nodes are closed.
 */
export class FogOfWar {
  readonly visible = new Set<number>();
  readonly explored = new Set<number>();

  constructor(readonly parent: SyntheticGraph) {
    if (!parent.csr) {
      throw new Error('FogOfWar requires a semantic synthetic graph');
    }
  }

  /** Cold-start: expand the seed so its neighbors enter the frontier. */
  static fromSeed(parent: SyntheticGraph, seedIndex: number): FogOfWar {
    const fog = new FogOfWar(parent);
    fog.expand(seedIndex);
    return fog;
  }

  /** Snapshot visible/explored sets for branching at an expansion budget. */
  clone(): FogOfWar {
    const fog = new FogOfWar(this.parent);
    for (const index of this.visible) fog.visible.add(index);
    for (const index of this.explored) fog.explored.add(index);
    return fog;
  }

  get csr(): CSRGraph {
    return this.parent.csr!;
  }

  expand(parentIndex: number): void {
    const csr = this.csr;
    this.visible.add(parentIndex);
    this.explored.add(parentIndex);
    const begin = csr.offsets[parentIndex];
    const end = csr.offsets[parentIndex + 1];
    for (let edge = begin; edge < end; edge++) {
      this.visible.add(csr.neighbors[edge]);
    }
  }

  materialize(): SyntheticGraph {
    return induceVisibleSubgraph(this.parent, this.visible, this.explored);
  }

  /** Run query propagation on the current visible subgraph. */
  observe(seedKey: string): FogObservation {
    const subgraph = this.materialize();
    const propagation = runQueryPropagation(
      subgraph.queryInput({ positive: { works: [seedKey] } }),
    );
    return {
      subgraph,
      relevance: Float64Array.from(propagation.relevance),
      authority: Float64Array.from(propagation.authority),
      precision: Float64Array.from(propagation.precision),
    };
  }

  parentIndexForSubgraphNode(subgraph: SyntheticGraph, subgraphIndex: number): number {
    const node = subgraph.csr!.nodeByIndex[subgraphIndex];
    return this.parent.index(node.kind, node.key);
  }
}

/**
 * Greedy next expansion under `policy` given a fresh observation.
 * Returns the parent-graph index to expand, or null only when the frontier
 * is empty (fully explored). Score thresholds are not applied here.
 *
 * Prefers `policy.propose` when the action binds a graph node. For
 * `worksSearch` actions, expands the first matching included tag that is
 * still expandable in the fog subgraph (synthetic graphs have no HTTP
 * search endpoint); otherwise falls back to the top frontier node.
 */
export function selectNextExpansion(
  fog: FogOfWar,
  policy: ExpansionPolicy,
  observation: FogObservation,
): number | null {
  const csr = observation.subgraph.csr!;
  const ctx = {
    csr,
    relevance: observation.relevance,
    authority: observation.authority,
    precision: observation.precision,
    rowOutFractions: csr.rowOutFractions,
    now: FOG_MATERIALIZE_EXPLORED_AT,
  };
  const frontier = policy.buildFrontier(ctx);
  if (frontier.length === 0) return null;

  const action = policy.propose(ctx, frontier);
  const subgraphIndex =
    subgraphIndexFromAction(csr, action, frontier) ?? frontier[0]!.index;
  return fog.parentIndexForSubgraphNode(observation.subgraph, subgraphIndex);
}

function subgraphIndexFromAction(
  csr: CSRGraph,
  action: ExpansionAction | null,
  frontier: { index: number }[],
): number | null {
  if (!action) return null;
  const plan = action.plan;

  if (plan.type === 'worksSearch') {
    return worksSearchProxyIndex(csr, plan.params, frontier);
  }

  if (plan.marksNodeId != null && plan.marksNodeId >= 0) {
    const byId = csr.indexByNodeId.get(plan.marksNodeId);
    if (byId !== undefined) return byId;
  }

  for (let i = 0; i < csr.nodeByIndex.length; i++) {
    const node = csr.nodeByIndex[i]!;
    if (plan.type === 'work' && node.kind === NodeKind.Work && node.key === plan.workId) {
      return i;
    }
    if (
      plan.type === 'tagListing' &&
      node.kind === NodeKind.Tag &&
      node.key === plan.tagName
    ) {
      return i;
    }
    if (
      plan.type === 'authorListing' &&
      node.kind === NodeKind.Author &&
      node.key === plan.authorKey
    ) {
      return i;
    }
  }
  return null;
}

/** Map a constructed AO3 search onto a fog node (prefer included expandable tags). */
function worksSearchProxyIndex(
  csr: CSRGraph,
  params: {
    fandomNames?: string[];
    characterNames?: string[];
    relationshipNames?: string[];
    freeformNames?: string[];
    creators?: string;
  },
  frontier: { index: number }[],
): number | null {
  const tagNames = [
    ...(params.fandomNames ?? []),
    ...(params.characterNames ?? []),
    ...(params.relationshipNames ?? []),
    ...(params.freeformNames ?? []),
  ];
  const frontierSet = new Set(frontier.map((n) => n.index));

  for (const name of tagNames) {
    for (let i = 0; i < csr.nodeByIndex.length; i++) {
      const node = csr.nodeByIndex[i]!;
      if (node.kind === NodeKind.Tag && node.key === name && frontierSet.has(i)) {
        return i;
      }
    }
  }

  if (params.creators) {
    for (let i = 0; i < csr.nodeByIndex.length; i++) {
      const node = csr.nodeByIndex[i]!;
      if (
        node.kind === NodeKind.Author &&
        node.key === params.creators &&
        frontierSet.has(i)
      ) {
        return i;
      }
    }
  }

  // Included tags may already be explored; still prefer them if present.
  for (const name of tagNames) {
    for (let i = 0; i < csr.nodeByIndex.length; i++) {
      const node = csr.nodeByIndex[i]!;
      if (node.kind === NodeKind.Tag && node.key === name) return i;
    }
  }

  return null;
}
