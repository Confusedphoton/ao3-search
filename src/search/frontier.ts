import { FRONTIER_EPSILON, MIN_FRONTIER_EXPECTED_INFO, PRECISION_EPS } from '../config/constants';
import type { CSRGraph } from '../graph/csr';
import { NodeKind } from '../graph/types';

export interface FrontierNode {
  nodeId: number;
  index: number;
  relevance: number;
  authority: number;
  precision: number;
  expectedInfo: number;
}

export function buildFrontier(
  csr: CSRGraph,
  relevance: Float64Array,
  authority: Float64Array,
  precision: Float64Array,
): FrontierNode[] {
  const frontier: FrontierNode[] = [];
  for (let index = 0; index < csr.nodeByIndex.length; index++) {
    const node = csr.nodeByIndex[index];
    if (node.explored) continue;
    const rel = relevance[index];
    const auth = authority[index];
    const prec = precision[index];
    frontier.push({
      nodeId: node.id,
      index,
      relevance: rel,
      authority: auth,
      precision: prec,
      expectedInfo: (rel * auth) / (prec + PRECISION_EPS),
    });
  }
  return frontier.sort((a, b) => b.expectedInfo - a.expectedInfo);
}

export function pickNextFrontier(frontier: FrontierNode[]): FrontierNode | null {
  if (frontier.length === 0) return null;
  if (frontier.length === 1) return frontier[0];
  if (Math.random() < FRONTIER_EPSILON) {
    return frontier[Math.floor(Math.random() * frontier.length)];
  }
  return frontier[0];
}

export function maxFrontierExpectedInfo(frontier: FrontierNode[]): number {
  return frontier[0]?.expectedInfo ?? 0;
}

export function isWorkNode(csr: CSRGraph, nodeId: number): boolean {
  const node = csr.nodeByIndex.find((n) => n.id === nodeId);
  return node?.kind === NodeKind.Work;
}
