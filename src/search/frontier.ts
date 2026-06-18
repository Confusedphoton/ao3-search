import { FRONTIER_EPSILON } from '../config/constants';
import type { CSRGraph } from '../graph/csr';
import { NodeKind } from '../graph/types';

export interface FrontierNode {
  nodeId: number;
  index: number;
  authority: number;
}

export function buildFrontier(csr: CSRGraph, authority: Float64Array): FrontierNode[] {
  const frontier: FrontierNode[] = [];
  for (let index = 0; index < csr.nodeByIndex.length; index++) {
    const node = csr.nodeByIndex[index];
    if (node.explored) continue;
    frontier.push({
      nodeId: node.id,
      index,
      authority: authority[index],
    });
  }
  return frontier.sort((a, b) => b.authority - a.authority);
}

export function pickNextFrontier(frontier: FrontierNode[]): FrontierNode | null {
  if (frontier.length === 0) return null;
  if (frontier.length === 1) return frontier[0];
  if (Math.random() < FRONTIER_EPSILON) {
    return frontier[Math.floor(Math.random() * frontier.length)];
  }
  return frontier[0];
}

export function maxFrontierAuthority(frontier: FrontierNode[]): number {
  return frontier[0]?.authority ?? 0;
}

export function isWorkNode(csr: CSRGraph, nodeId: number): boolean {
  const node = csr.nodeByIndex.find((n) => n.id === nodeId);
  return node?.kind === NodeKind.Work;
}
