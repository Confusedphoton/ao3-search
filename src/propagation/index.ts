import {
  NEGATIVE_SEED_WEIGHT,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';
import { runPropagation } from './engine';
import { buildPropagationGraphFromArrays } from './queryGraph';
import { CONFIDENCE_SIGNAL_ID, createConfidenceSignal } from './signals/confidence';
import {
  createRankSeedContext,
  createRankSignal,
  RANK_SIGNAL_ID,
} from './signals/rank';
import type { PropagationParams, PropagationResult, SeedContext, SignalInstance } from './types';

export type { PropagationGraph, PropagationParams, PropagationResult, SeedContext, SignalInstance, SignalUpdateRule } from './types';
export { runPropagation } from './engine';
export { spreadMass } from './spread';
export { buildPropagationGraph, buildPropagationGraphFromArrays } from './queryGraph';
export { applyPageRankStep, l1Normalize, pageRankUpdateRule } from './rules/pageRankStep';
export { buildTransitionWeights } from './queryGraph';
export {
  RANK_SIGNAL_ID,
  buildRankTeleport,
  createRankSeedContext,
  createRankSignal,
  rankUpdateRule,
} from './signals/rank';
export {
  CONFIDENCE_SIGNAL_ID,
  buildConfidenceTeleport,
  confidenceUpdateRule,
  createConfidenceSignal,
} from './signals/confidence';

export interface RankPropagationInput {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions?: number[] | Float64Array;
  seedIndices: number[];
  negativeSeedIndices?: number[];
  negativeWeight?: number;
  alpha?: number;
  maxIterations?: number;
  tolerance?: number;
}

export interface RankPropagationResult {
  authority: Float64Array;
  iterations: number;
  delta: number;
}

const SIGNAL_FACTORIES: Record<string, (context: SeedContext) => SignalInstance> = {
  [RANK_SIGNAL_ID]: createRankSignal,
  [CONFIDENCE_SIGNAL_ID]: createConfidenceSignal,
};

export function createSignals(
  signalIds: string[],
  context: SeedContext,
): SignalInstance[] {
  return signalIds.map((id) => {
    const factory = SIGNAL_FACTORIES[id];
    if (!factory) throw new Error(`Unknown signal id: ${id}`);
    return factory(context);
  });
}

export function runRankPropagation(input: RankPropagationInput): RankPropagationResult {
  const {
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    seedIndices,
    negativeSeedIndices = [],
    negativeWeight = NEGATIVE_SEED_WEIGHT,
    alpha = PPR_ALPHA,
    maxIterations = PPR_MAX_ITERATIONS,
    tolerance = PPR_TOLERANCE,
  } = input;

  const nodeCount = offsets.length - 1;
  const authority = new Float64Array(nodeCount);

  if (seedIndices.length === 0 && negativeSeedIndices.length === 0) {
    return { authority, iterations: 0, delta: 0 };
  }

  const graph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    negativeSeedIndices,
    rowOutFractions,
  );
  const context = createRankSeedContext(
    nodeCount,
    seedIndices,
    negativeSeedIndices,
    negativeWeight,
  );
  const params: PropagationParams = { alpha, maxIterations, tolerance };
  const result = runPropagation(graph, [createRankSignal(context)], params);

  return {
    authority: result.signals[RANK_SIGNAL_ID] ?? authority,
    iterations: result.iterations,
    delta: result.deltas[RANK_SIGNAL_ID] ?? 0,
  };
}

export interface MultiSignalPropagationInput extends RankPropagationInput {
  signalIds: string[];
}

export function runMultiSignalPropagation(
  input: MultiSignalPropagationInput,
): PropagationResult {
  const {
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    seedIndices,
    negativeSeedIndices = [],
    negativeWeight = NEGATIVE_SEED_WEIGHT,
    alpha = PPR_ALPHA,
    maxIterations = PPR_MAX_ITERATIONS,
    tolerance = PPR_TOLERANCE,
    signalIds,
  } = input;

  const nodeCount = offsets.length - 1;
  const emptySignals: Record<string, Float64Array> = {};
  for (const id of signalIds) {
    emptySignals[id] = new Float64Array(nodeCount);
  }

  if (signalIds.length === 0) {
    return { signals: {}, iterations: 0, deltas: {} };
  }

  if (seedIndices.length === 0 && negativeSeedIndices.length === 0) {
    return { signals: emptySignals, iterations: 0, deltas: {} };
  }

  const graph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    negativeSeedIndices,
    rowOutFractions,
  );
  const context = createRankSeedContext(
    nodeCount,
    seedIndices,
    negativeSeedIndices,
    negativeWeight,
  );
  const params: PropagationParams = { alpha, maxIterations, tolerance };
  const signals = createSignals(signalIds, context);

  return runPropagation(graph, signals, params);
}

export function topWorkIndices(
  state: Float64Array,
  workIndices: number[],
  limit: number,
): Array<{ index: number; score: number }> {
  const ranked = workIndices
    .map((index) => ({ index, score: state[index] }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
