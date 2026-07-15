import { buildCSR, type CSRGraph } from '@/src/graph/csr';
import { normalizeExplorationFields } from '@/src/graph/exploration';
import { NodeKind, type AuthorWorkEdge, type GraphEdge, type GraphNode } from '@/src/graph/types';
import { SyntheticGraph } from '../../tests/fixtures/syntheticGraph';

/** Shared with fog-of-war policy `now` so complete hubs are not stale-rechecked. */
export const FOG_MATERIALIZE_EXPLORED_AT = 1_000_000;

/**
 * Undirected BFS distances from a seed index on the CSR adjacency.
 * Unreachable nodes are omitted from the returned map.
 */
export function bfsDistances(csr: CSRGraph, seedIndex: number): Map<number, number> {
  const distances = new Map<number, number>([[seedIndex, 0]]);
  const queue = [seedIndex];

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const dist = distances.get(node)!;
    const begin = csr.offsets[node];
    const end = csr.offsets[node + 1];
    for (let edge = begin; edge < end; edge++) {
      const neighbor = csr.neighbors[edge];
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, dist + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

function authorNeighborSet(csr: CSRGraph): Set<string> {
  const pairs = new Set<string>();
  for (const edge of csr.authorWorkIndexEdges) {
    pairs.add(`${edge.workIndex}:${edge.authorIndex}`);
    pairs.add(`${edge.authorIndex}:${edge.workIndex}`);
  }
  return pairs;
}

/**
 * Induced subgraph on visible parent indices.
 * Explored nodes are closed; other visible nodes stay unexplored so
 * `rowOutFraction` leaks according to full-graph hub frequency.
 */
export function induceVisibleSubgraph(
  parent: SyntheticGraph,
  visibleIndices: Iterable<number>,
  exploredIndices: ReadonlySet<number>,
): SyntheticGraph {
  const csr = parent.csr;
  if (!csr) {
    throw new Error('induceVisibleSubgraph requires a semantic synthetic graph');
  }

  const included = [...new Set(visibleIndices)].sort((a, b) => a - b);
  const includedSet = new Set(included);
  const authorPairs = authorNeighborSet(csr);

  const nodes: GraphNode[] = [];
  const oldToNewId = new Map<number, number>();
  let nextId = 1;

  for (const oldIndex of included) {
    const source = csr.nodeByIndex[oldIndex];
    const explored = exploredIndices.has(oldIndex);
    const id = nextId++;
    oldToNewId.set(oldIndex, id);
    nodes.push(
      normalizeExplorationFields({
        ...source,
        id,
        explorationStatus: explored ? 'complete' : 'unexplored',
        explored,
        // Use a recent timestamp so stale-hub rechecks do not fire in evals.
        exploredAt: explored ? FOG_MATERIALIZE_EXPLORED_AT : null,
        listingNextPage: null,
        listingPagesFetched: explored ? Math.max(source.listingPagesFetched ?? 1, 1) : 0,
      }),
    );
  }

  const edges: GraphEdge[] = [];
  const authorEdges: AuthorWorkEdge[] = [];

  for (const oldIndex of included) {
    const node = csr.nodeByIndex[oldIndex];
    if (node.kind !== NodeKind.Work) continue;

    const workNodeId = oldToNewId.get(oldIndex)!;
    const begin = csr.offsets[oldIndex];
    const end = csr.offsets[oldIndex + 1];
    for (let edge = begin; edge < end; edge++) {
      const neighbor = csr.neighbors[edge];
      if (!includedSet.has(neighbor)) continue;
      const neighborNode = csr.nodeByIndex[neighbor];
      const neighborId = oldToNewId.get(neighbor)!;
      if (neighborNode.kind === NodeKind.Tag) {
        edges.push({ workNodeId, tagNodeId: neighborId });
      } else if (
        neighborNode.kind === NodeKind.Author &&
        authorPairs.has(`${oldIndex}:${neighbor}`)
      ) {
        authorEdges.push({ workNodeId, authorNodeId: neighborId });
      }
    }
  }

  return SyntheticGraph.fromCsr(buildCSR({ nodes, edges, authorEdges }));
}

/**
 * Induced open depth-ball around a seed (hop radius).
 *
 * Nodes with distance < depth are marked explored (closed rows).
 * Nodes on the boundary (distance === depth) stay unexplored so
 * `rowOutFraction` leaks according to full-graph hub frequency.
 */
export function extractDepthBall(
  parent: SyntheticGraph,
  seedIndex: number,
  depth: number,
): { graph: SyntheticGraph; includedIndices: number[]; distances: Map<number, number> } {
  const csr = parent.csr;
  if (!csr) {
    throw new Error('extractDepthBall requires a semantic synthetic graph');
  }
  if (depth < 0) {
    throw new Error('depth must be non-negative');
  }

  const distances = bfsDistances(csr, seedIndex);
  const included = [...distances.entries()]
    .filter(([, dist]) => dist <= depth)
    .map(([index]) => index)
    .sort((a, b) => a - b);

  const explored = new Set(
    included.filter((index) => {
      const dist = distances.get(index)!;
      return dist < depth || depth === 0;
    }),
  );

  return {
    graph: induceVisibleSubgraph(parent, included, explored),
    includedIndices: included,
    distances,
  };
}

export function maxFiniteDistance(distances: Map<number, number>): number {
  let max = 0;
  for (const dist of distances.values()) {
    if (dist > max) max = dist;
  }
  return max;
}
