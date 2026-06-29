import { PRECISION_EPS } from '../config/constants';
import type { PropagationGraph } from './types';

export function precisionPriorFromLog(priorLog: Float64Array): Float64Array {
  const tau0 = new Float64Array(priorLog.length);
  for (let i = 0; i < priorLog.length; i++) {
    tau0[i] = 1 + Math.log(1 + Math.exp(priorLog[i]));
  }
  return tau0;
}

export function precisionLogFactor(priorLog: number): number {
  return Math.log(1 + Math.exp(priorLog));
}

export function spreadPrecisionMass(
  graph: PropagationGraph,
  authority: Float64Array,
  tau0: Float64Array,
  priorLog: Float64Array,
  buffer: Float64Array,
): void {
  buffer.fill(0);

  for (let u = 0; u < graph.nodeCount; u++) {
    const start = graph.offsets[u];
    const end = graph.offsets[u + 1];
    if (start === end) continue;

    const contribution =
      authority[u] * tau0[u] * precisionLogFactor(priorLog[u]);
    if (contribution === 0) continue;

    for (let edge = start; edge < end; edge++) {
      buffer[graph.neighbors[edge]] += graph.transitionWeights[edge] * contribution;
    }
  }
}

export function computePrecision(
  graph: PropagationGraph,
  priorLog: Float64Array,
  authority: Float64Array,
): Float64Array {
  const tau0 = precisionPriorFromLog(priorLog);
  const spread = new Float64Array(graph.nodeCount);
  spreadPrecisionMass(graph, authority, tau0, priorLog, spread);

  const precision = new Float64Array(graph.nodeCount);
  for (let i = 0; i < graph.nodeCount; i++) {
    precision[i] = tau0[i] + spread[i];
  }
  return precision;
}

export function computeExpectedInfo(
  relevance: Float64Array,
  authority: Float64Array,
  precision: Float64Array,
): Float64Array {
  const expectedInfo = new Float64Array(relevance.length);
  for (let i = 0; i < relevance.length; i++) {
    expectedInfo[i] = (relevance[i] * authority[i]) / (precision[i] + PRECISION_EPS);
  }
  return expectedInfo;
}
