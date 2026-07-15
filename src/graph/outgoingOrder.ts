import type { GraphNode } from './types';
import { NodeKind } from './types';
import { isFullyExplored } from './exploration';

export function hubFrequency(node: GraphNode): number {
  return node.calibratedFreq ?? node.estimatedFreq ?? 1;
}

/** Estimated total outgoing connections in the full closed graph. */
export function outgoingOrder(node: GraphNode): number {
  return Math.max(hubFrequency(node), 1);
}

/**
 * Fraction of a node's outgoing mass that flows through observed edges.
 * Fully explored nodes are treated as fully observed. Incomplete works retain
 * one edge of uncertainty; hubs use their estimated outgoing order.
 */
export function rowOutFraction(node: GraphNode, observedOutDegree: number): number {
  if (observedOutDegree <= 0) return 0;
  if (isFullyExplored(node)) return 1;
  if (node.kind === NodeKind.Work) {
    return observedOutDegree / (observedOutDegree + 1);
  }
  return Math.min(1, observedOutDegree / outgoingOrder(node));
}
