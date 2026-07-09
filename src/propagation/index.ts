import {
  NEGATIVE_RELEVANCE_LAMBDA,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';
import { runPropagation } from './engine';
import { buildPropagationGraphFromArrays } from './queryGraph';
import {
  contrastRelevance,
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
  applyPermeabilityFilter,
  buildNodePermeabilities,
  categoryPermeability,
  workPermeability,
} from './permeability';
export {
  RELEVANCE_SIGNAL_ID,
  buildRelevanceTeleport,
  contrastRelevance,
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
  /** Multiplier λ for score = r⁺ − λ r⁻. Defaults to NEGATIVE_RELEVANCE_LAMBDA. */
  negativeLambda?: number;
  alpha?: number;
  maxIterations?: number;
  tolerance?: number;
}

export interface RelevancePropagationResult {
  /** Contrast score r⁺ − λ r⁻ (equals r⁺ when there are no negatives). */
  relevance: Float64Array;
  positiveRelevance: Float64Array;
  negativeRelevance: Float64Array | null;
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

function runUnsignedRelevancePpr(
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
  rowOutFractions: number[] | Float64Array | undefined,
  seedIndices: number[],
  params: PropagationParams,
): { relevance: Float64Array; iterations: number; delta: number } {
  const nodeCount = offsets.length - 1;
  if (seedIndices.length === 0) {
    return { relevance: new Float64Array(nodeCount), iterations: 0, delta: 0 };
  }

  const graph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    [],
    rowOutFractions,
  );
  const context = createSeedContext(nodeCount, seedIndices);
  const result = runPropagation(graph, [createRelevanceSignal(context)], params);
  return {
    relevance: result.signals[RELEVANCE_SIGNAL_ID] ?? new Float64Array(nodeCount),
    iterations: result.iterations,
    delta: result.deltas[RELEVANCE_SIGNAL_ID] ?? 0,
  };
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
    negativeLambda = NEGATIVE_RELEVANCE_LAMBDA,
    alpha = PPR_ALPHA,
    maxIterations = PPR_MAX_ITERATIONS,
    tolerance = PPR_TOLERANCE,
  } = input;

  const nodeCount = offsets.length - 1;
  const empty = new Float64Array(nodeCount);

  if (seedIndices.length === 0 && negativeSeedIndices.length === 0) {
    return {
      relevance: empty,
      positiveRelevance: empty,
      negativeRelevance: null,
      iterations: 0,
      delta: 0,
    };
  }

  const params: PropagationParams = { alpha, maxIterations, tolerance };
  const positive = runUnsignedRelevancePpr(
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    seedIndices,
    params,
  );
  const negative = runUnsignedRelevancePpr(
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    negativeSeedIndices,
    params,
  );
  const negativeRelevance =
    negativeSeedIndices.length > 0 ? negative.relevance : null;

  return {
    relevance: contrastRelevance(positive.relevance, negativeRelevance, negativeLambda),
    positiveRelevance: positive.relevance,
    negativeRelevance,
    iterations: positive.iterations + negative.iterations,
    delta: Math.max(positive.delta, negative.delta),
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

  // Multi-signal path remains positive-seed only; dual contrast is query/relevance API.
  const graph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    [],
    rowOutFractions,
  );
  const context = createSeedContext(nodeCount, seedIndices, negativeSeedIndices);
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
