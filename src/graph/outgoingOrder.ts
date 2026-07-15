import type { GraphNode } from './types';
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
 * Fully explored nodes are treated as fully observed; incomplete / partial
 * hubs leak proportionally to observed degree vs estimated order.
 */
export function rowOutFraction(node: GraphNode, observedOutDegree: number): number {
  if (observedOutDegree <= 0) return 0;
  if (isFullyExplored(node)) return 1;
  return Math.min(1, observedOutDegree / outgoingOrder(node));
}
