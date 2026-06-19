import { spreadMass } from './spread';
import type { PropagationGraph, PropagationParams, PropagationResult, SignalInstance } from './types';

export function runPropagation(
  graph: PropagationGraph,
  signals: SignalInstance[],
  params: PropagationParams,
): PropagationResult {
  if (signals.length === 0) {
    return { signals: {}, iterations: 0, deltas: {} };
  }

  let iterations = 0;
  const deltas: Record<string, number> = {};

  while (iterations < params.maxIterations) {
    let maxDelta = 0;

    for (const signal of signals) {
      spreadMass(graph, signal.state, signal.buffer);
      const delta = signal.rule.applyIteration(
        signal.state,
        signal.buffer,
        signal.teleport,
        params,
      );
      deltas[signal.id] = delta;
      if (delta > maxDelta) maxDelta = delta;
    }

    iterations++;
    if (maxDelta <= params.tolerance) break;
  }

  const signalStates: Record<string, Float64Array> = {};
  for (const signal of signals) {
    signalStates[signal.id] = signal.state;
  }

  return { signals: signalStates, iterations, deltas };
}
