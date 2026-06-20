import { hubFrequency, rowOutFraction } from './outgoingOrder';
import type { GraphNode, GraphSnapshot } from './types';
import { NodeKind } from './types';

export interface CSRGraph {
  nodeCount: number;
  nodeIds: number[];
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions: Float64Array;
  workIndices: number[];
  tagIndices: number[];
  authorIndices: number[];
  indexByNodeId: Map<number, number>;
  nodeByIndex: GraphNode[];
}

export function tagWeight(freq: number): number {
  const safe = Math.max(freq, 1);
  return 1 / Math.log(safe + 1);
}

export function buildCSR(snapshot: GraphSnapshot): CSRGraph {
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const nodeIds = snapshot.nodes.map((n) => n.id).sort((a, b) => a - b);
  const indexByNodeId = new Map<number, number>();
  nodeIds.forEach((id, index) => indexByNodeId.set(id, index));

  const adjacency = Array.from({ length: nodeIds.length }, () => [] as { to: number; weight: number }[]);

  const worksByTag = new Map<number, number[]>();
  for (const edge of snapshot.edges) {
    if (!worksByTag.has(edge.tagNodeId)) worksByTag.set(edge.tagNodeId, []);
    worksByTag.get(edge.tagNodeId)!.push(edge.workNodeId);
  }

  for (const edge of snapshot.edges) {
    const workIndex = indexByNodeId.get(edge.workNodeId);
    const tagIndex = indexByNodeId.get(edge.tagNodeId);
    if (workIndex === undefined || tagIndex === undefined) continue;

    const tagNode = nodeById.get(edge.tagNodeId);
    if (!tagNode) continue;

    const wToT = tagWeight(hubFrequency(tagNode));
    const connectedWorks = worksByTag.get(edge.tagNodeId) ?? [];
    const tToW = connectedWorks.length > 0 ? 1 / connectedWorks.length : 1;

    adjacency[workIndex].push({ to: tagIndex, weight: wToT });
    adjacency[tagIndex].push({ to: workIndex, weight: tToW });
  }

  const worksByAuthor = new Map<number, number[]>();
  for (const edge of snapshot.authorEdges) {
    if (!worksByAuthor.has(edge.authorNodeId)) worksByAuthor.set(edge.authorNodeId, []);
    worksByAuthor.get(edge.authorNodeId)!.push(edge.workNodeId);
  }

  for (const edge of snapshot.authorEdges) {
    const workIndex = indexByNodeId.get(edge.workNodeId);
    const authorIndex = indexByNodeId.get(edge.authorNodeId);
    if (workIndex === undefined || authorIndex === undefined) continue;

    const authorNode = nodeById.get(edge.authorNodeId);
    if (!authorNode) continue;

    const wToA = tagWeight(hubFrequency(authorNode));
    const connectedWorks = worksByAuthor.get(edge.authorNodeId) ?? [];
    const aToW = connectedWorks.length > 0 ? 1 / connectedWorks.length : 1;

    adjacency[workIndex].push({ to: authorIndex, weight: wToA });
    adjacency[authorIndex].push({ to: workIndex, weight: aToW });
  }

  const offsets: number[] = [0];
  const neighbors: number[] = [];
  const edgeWeights: number[] = [];

  for (const edges of adjacency) {
    const grouped = new Map<number, number>();
    for (const edge of edges) {
      grouped.set(edge.to, (grouped.get(edge.to) ?? 0) + edge.weight);
    }
    for (const [to, weight] of grouped) {
      neighbors.push(to);
      edgeWeights.push(weight);
    }
    offsets.push(neighbors.length);
  }

  const nodeByIndex = nodeIds.map((id) => nodeById.get(id)!);
  const rowOutFractions = new Float64Array(nodeIds.length);
  for (let index = 0; index < nodeIds.length; index++) {
    const outDegree = offsets[index + 1] - offsets[index];
    rowOutFractions[index] = rowOutFraction(nodeByIndex[index], outDegree);
  }
  const workIndices: number[] = [];
  const tagIndices: number[] = [];
  const authorIndices: number[] = [];
  nodeByIndex.forEach((node, index) => {
    if (node.kind === NodeKind.Work) workIndices.push(index);
    else if (node.kind === NodeKind.Tag) tagIndices.push(index);
    else authorIndices.push(index);
  });

  return {
    nodeCount: nodeIds.length,
    nodeIds,
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    workIndices,
    tagIndices,
    authorIndices,
    indexByNodeId,
    nodeByIndex,
  };
}

export function seedIndicesForWorks(csr: CSRGraph, seedWorkIds: string[]): number[] {
  const indices: number[] = [];
  for (const workId of seedWorkIds) {
    for (let i = 0; i < csr.nodeByIndex.length; i++) {
      const node = csr.nodeByIndex[i];
      if (node.kind === NodeKind.Work && node.key === workId) {
        indices.push(i);
        break;
      }
    }
  }
  return indices;
}

export function seedIndicesForTags(csr: CSRGraph, tagNames: string[]): number[] {
  const indices: number[] = [];
  for (const tagName of tagNames) {
    for (let i = 0; i < csr.nodeByIndex.length; i++) {
      const node = csr.nodeByIndex[i];
      if (node.kind === NodeKind.Tag && node.key === tagName) {
        indices.push(i);
        break;
      }
    }
  }
  return indices;
}

export function seedIndicesForNegativeSeeds(
  csr: CSRGraph,
  negativeSeeds: Array<{ kind: 'work' | 'tag'; key: string }>,
): number[] {
  return seedIndicesForSignedSeeds(csr, negativeSeeds);
}

export function seedIndicesForPositiveSeeds(
  csr: CSRGraph,
  positiveSeeds: Array<{ kind: 'work' | 'tag'; key: string }>,
): number[] {
  return seedIndicesForSignedSeeds(csr, positiveSeeds);
}

function seedIndicesForSignedSeeds(
  csr: CSRGraph,
  seeds: Array<{ kind: 'work' | 'tag'; key: string }>,
): number[] {
  const workIds = seeds.filter((s) => s.kind === 'work').map((s) => s.key);
  const tagNames = seeds.filter((s) => s.kind === 'tag').map((s) => s.key);
  return [...seedIndicesForWorks(csr, workIds), ...seedIndicesForTags(csr, tagNames)];
}
