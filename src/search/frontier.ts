import { CONTINUE_FRONTIER_EPSILON, FRONTIER_EPSILON, PRECISION_EPS } from '../config/constants';
import type { CSRGraph } from '../graph/csr';
import { isExpandable } from '../graph/exploration';
import { NodeKind } from '../graph/types';

export interface FrontierNode {
  nodeId: number;
  index: number;
  relevance: number;
  authority: number;
  precision: number;
  expectedInfo: number;
  /** Acquisition score for non-expected-info policies (e.g. fragility). */
  score?: number;
}

export function buildFrontier(
  csr: CSRGraph,
  relevance: Float64Array,
  authority: Float64Array,
  precision: Float64Array,
  now = Date.now(),
): FrontierNode[] {
  const frontier: FrontierNode[] = [];
  for (let index = 0; index < csr.nodeByIndex.length; index++) {
    const node = csr.nodeByIndex[index];
    if (!isExpandable(node, now)) continue;
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

export function pickNextFrontier(
  frontier: FrontierNode[],
  options: { exploratory?: boolean } = {},
): FrontierNode | null {
  if (frontier.length === 0) return null;
  if (frontier.length === 1) return frontier[0];
  const epsilon = options.exploratory ? CONTINUE_FRONTIER_EPSILON : FRONTIER_EPSILON;
  if (Math.random() < epsilon) {
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
