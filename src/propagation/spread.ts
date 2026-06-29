import type { PropagationGraph } from './types';

export interface SpreadOptions {
  receiverWeights?: Float64Array;
}

export function spreadMass(
  graph: PropagationGraph,
  state: Float64Array,
  buffer: Float64Array,
  options: SpreadOptions = {},
): void {
  buffer.fill(0);
  const { receiverWeights } = options;

  for (let node = 0; node < graph.nodeCount; node++) {
    const start = graph.offsets[node];
    const end = graph.offsets[node + 1];
    const mass = state[node];
    if (mass === 0 || start === end) continue;

    for (let edge = start; edge < end; edge++) {
      const neighbor = graph.neighbors[edge];
      const receiverWeight = receiverWeights?.[neighbor] ?? 1;
      buffer[neighbor] += mass * graph.transitionWeights[edge] * receiverWeight;
    }
  }
}
