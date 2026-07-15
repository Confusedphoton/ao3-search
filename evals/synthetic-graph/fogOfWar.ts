import type { CSRGraph } from '@/src/graph/csr';
import type { ExpansionPolicy } from '@/src/search/expansionPolicy';
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
 */
export function selectNextExpansion(
  fog: FogOfWar,
  policy: ExpansionPolicy,
  observation: FogObservation,
): number | null {
  const csr = observation.subgraph.csr!;
  const frontier = policy.buildFrontier({
    csr,
    relevance: observation.relevance,
    authority: observation.authority,
    precision: observation.precision,
    rowOutFractions: csr.rowOutFractions,
    now: FOG_MATERIALIZE_EXPLORED_AT,
  });
  if (frontier.length === 0) return null;

  return fog.parentIndexForSubgraphNode(observation.subgraph, frontier[0].index);
}
