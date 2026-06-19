import type { PropagationGraph } from './types';

export function spreadMass(
  graph: PropagationGraph,
  state: Float64Array,
  buffer: Float64Array,
): void {
  buffer.fill(0);

  for (let node = 0; node < graph.nodeCount; node++) {
    const start = graph.offsets[node];
    const end = graph.offsets[node + 1];
    const mass = state[node];
    if (mass === 0 || start === end) continue;

    for (let edge = start; edge < end; edge++) {
      buffer[graph.neighbors[edge]] += mass * graph.transitionWeights[edge];
    }
  }
}
