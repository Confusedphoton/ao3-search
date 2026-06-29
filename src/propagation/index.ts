import {
  NEGATIVE_SEED_WEIGHT,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';
import { runPropagation } from './engine';
import { buildPropagationGraphFromArrays } from './queryGraph';
import {
  createRelevanceSignal,
  createSeedContext,
  RELEVANCE_SIGNAL_ID,
} from './signals/relevance';
import type { PropagationParams, PropagationResult, SeedContext, SignalInstance } from './types';

export type { PropagationGraph, PropagationParams, PropagationResult, SeedContext, SignalInstance, SignalUpdateRule } from './types';
export { runPropagation } from './engine';
export { spreadMass } from './spread';
export { buildPropagationGraph, buildPropagationGraphFromArrays } from './queryGraph';
export { applyPageRankStep, l1Normalize, pageRankUpdateRule } from './rules/pageRankStep';
export { buildTransitionWeights } from './queryGraph';
export {
  RELEVANCE_SIGNAL_ID,
  buildRelevanceTeleport,
  createRelevanceSignal,
  createSeedContext,
  relevanceUpdateRule,
} from './signals/relevance';
export {
  AUTHORITY_SIGNAL_ID,
  authorityUpdateRule,
  createAuthoritySignal,
} from './signals/authority';
export {
  buildPriorLog,
  buildTeleportFromPriorLog,
  computeAuthorPriorLog,
  computeWorkPriorLog,
  mergeTagPriorLog,
  workPriorLog,
} from './priors';
export type { PriorGraph } from './priors';
export { computeTagPriorLogFromFlux } from './tagFlux';
export {
  computeExpectedInfo,
  computePrecision,
  precisionPriorFromLog,
  spreadPrecisionMass,
} from './precision';
export {
  queryInputFromCsr,
  runQueryPropagation,
} from './runQueryPropagation';
export type { QueryPropagationInput, QueryPropagationResult } from './runQueryPropagation';

export interface RelevancePropagationInput {
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

export interface RelevancePropagationResult {
  relevance: Float64Array;
  iterations: number;
  delta: number;
}

const SIGNAL_FACTORIES: Record<string, (context: SeedContext) => SignalInstance> = {
  [RELEVANCE_SIGNAL_ID]: createRelevanceSignal,
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

export function runRelevancePropagation(
  input: RelevancePropagationInput,
): RelevancePropagationResult {
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
  const relevance = new Float64Array(nodeCount);

  if (seedIndices.length === 0 && negativeSeedIndices.length === 0) {
    return { relevance, iterations: 0, delta: 0 };
  }

  const graph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    negativeSeedIndices,
    rowOutFractions,
  );
  const context = createSeedContext(
    nodeCount,
    seedIndices,
    negativeSeedIndices,
    negativeWeight,
  );
  const params: PropagationParams = { alpha, maxIterations, tolerance };
  const result = runPropagation(graph, [createRelevanceSignal(context)], params);

  return {
    relevance: result.signals[RELEVANCE_SIGNAL_ID] ?? relevance,
    iterations: result.iterations,
    delta: result.deltas[RELEVANCE_SIGNAL_ID] ?? 0,
  };
}

export interface MultiSignalPropagationInput extends RelevancePropagationInput {
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
  const context = createSeedContext(
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
  relevance: Float64Array,
  workIndices: number[],
  limit: number,
): Array<{ index: number; score: number }> {
  const ranked = workIndices
    .map((index) => ({ index, score: relevance[index] }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
