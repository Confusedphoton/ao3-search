import type { GraphNode, GraphSnapshot } from './types';
import { NodeKind } from './types';

export interface CSRGraph {
  nodeCount: number;
  nodeIds: number[];
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  workIndices: number[];
  tagIndices: number[];
  indexByNodeId: Map<number, number>;
  nodeByIndex: GraphNode[];
}

function tagFrequency(node: GraphNode): number {
  return node.calibratedFreq ?? node.estimatedFreq ?? 1;
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

    const wToT = tagWeight(tagFrequency(tagNode));
    const connectedWorks = worksByTag.get(edge.tagNodeId) ?? [];
    const tToW = connectedWorks.length > 0 ? 1 / connectedWorks.length : 1;

    adjacency[workIndex].push({ to: tagIndex, weight: wToT });
    adjacency[tagIndex].push({ to: workIndex, weight: tToW });
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

  normalizeOutgoing(nodeIds.length, offsets, neighbors, edgeWeights);

  const nodeByIndex = nodeIds.map((id) => nodeById.get(id)!);
  const workIndices: number[] = [];
  const tagIndices: number[] = [];
  nodeByIndex.forEach((node, index) => {
    if (node.kind === NodeKind.Work) workIndices.push(index);
    else tagIndices.push(index);
  });

  return {
    nodeCount: nodeIds.length,
    nodeIds,
    offsets,
    neighbors,
    edgeWeights,
    workIndices,
    tagIndices,
    indexByNodeId,
    nodeByIndex,
  };
}

function normalizeOutgoing(
  nodeCount: number,
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
): void {
  for (let node = 0; node < nodeCount; node++) {
    const start = offsets[node];
    const end = offsets[node + 1];
    let sum = 0;
    for (let i = start; i < end; i++) sum += edgeWeights[i];
    if (sum <= 0) continue;
    for (let i = start; i < end; i++) edgeWeights[i] /= sum;
  }
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
  const workIds = negativeSeeds.filter((s) => s.kind === 'work').map((s) => s.key);
  const tagNames = negativeSeeds.filter((s) => s.kind === 'tag').map((s) => s.key);
  return [...seedIndicesForWorks(csr, workIds), ...seedIndicesForTags(csr, tagNames)];
}
