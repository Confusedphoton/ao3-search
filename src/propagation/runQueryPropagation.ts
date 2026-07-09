import {
  NEGATIVE_RELEVANCE_LAMBDA,
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';
import { NodeKind } from '../graph/types';
import type { QueryPropagationInputPayload } from '../messaging/types';
import type { PriorGraph } from './priors';
import { runPropagation } from './engine';
import { computeExpectedInfo, computePrecision } from './precision';
import {
  buildPriorLog,
  buildTeleportFromPriorLog,
  mergeTagPriorLog,
} from './priors';
import { buildPropagationGraphFromArrays } from './queryGraph';
import { createAuthoritySignal, AUTHORITY_SIGNAL_ID } from './signals/authority';
import {
  contrastRelevance,
  createSeedContext,
  createRelevanceSignal,
  RELEVANCE_SIGNAL_ID,
} from './signals/relevance';
import { computeTagPriorLogFromFlux } from './tagFlux';
import type { PropagationParams } from './types';

export interface QueryPropagationInput {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions?: number[] | Float64Array;
  seedIndices: number[];
  negativeSeedIndices?: number[];
  /** Multiplier λ for score = r⁺ − λ r⁻. Defaults to NEGATIVE_RELEVANCE_LAMBDA. */
  negativeLambda?: number;
  workIndices: number[];
  tagIndices: number[];
  authorIndices: number[];
  authorWorkIndexEdges: Array<{ workIndex: number; authorIndex: number }>;
  wordCounts: Array<number | null>;
  nodeKinds: NodeKind[];
  alpha?: number;
  maxIterations?: number;
  tolerance?: number;
}

export interface QueryPropagationResult {
  /** Contrast score r⁺ − λ r⁻ used for ranking and frontier expectedInfo. */
  relevance: Float64Array;
  /** Positive-seed PPR (unsigned). */
  positiveRelevance: Float64Array;
  /** Negative-seed PPR (unsigned), or null when there are no negative seeds. */
  negativeRelevance: Float64Array | null;
  authority: Float64Array;
  precision: Float64Array;
  expectedInfo: Float64Array;
  iterations: { relevance: number; authority: number };
}

interface PriorCsrView extends PriorGraph {}

function buildPriorCsrView(input: QueryPropagationInput): PriorGraph {
  return {
    nodeCount: input.offsets.length - 1,
    workIndices: input.workIndices,
    tagIndices: input.tagIndices,
    authorIndices: input.authorIndices,
    authorWorkIndexEdges: input.authorWorkIndexEdges,
    nodeByIndex: input.nodeKinds.map((kind, index) => ({
      kind,
      wordCount: input.wordCounts[index] ?? null,
    })),
  };
}

function runAuthorityPropagation(
  graph: ReturnType<typeof buildPropagationGraphFromArrays>,
  priorLog: Float64Array,
  params: PropagationParams,
): { authority: Float64Array; iterations: number } {
  const teleport = buildTeleportFromPriorLog(priorLog);
  const signal = createAuthoritySignal(graph.nodeCount, teleport);
  const result = runPropagation(graph, [signal], params);
  return {
    authority: result.signals[AUTHORITY_SIGNAL_ID] ?? new Float64Array(graph.nodeCount),
    iterations: result.iterations,
  };
}

function runUnsignedRelevance(
  graph: ReturnType<typeof buildPropagationGraphFromArrays>,
  seedIndices: number[],
  authority: Float64Array,
  params: PropagationParams,
): { relevance: Float64Array; iterations: number } {
  if (seedIndices.length === 0) {
    return { relevance: new Float64Array(graph.nodeCount), iterations: 0 };
  }

  const context = createSeedContext(graph.nodeCount, seedIndices);
  const signal = createRelevanceSignal(context);
  signal.receiverWeights = authority;
  const result = runPropagation(graph, [signal], params);
  return {
    relevance: result.signals[RELEVANCE_SIGNAL_ID] ?? new Float64Array(graph.nodeCount),
    iterations: result.iterations,
  };
}

export function runQueryPropagation(input: QueryPropagationInput): QueryPropagationResult {
  const {
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    seedIndices,
    negativeSeedIndices = [],
    negativeLambda = NEGATIVE_RELEVANCE_LAMBDA,
    tagIndices,
    nodeKinds,
    alpha = PPR_ALPHA,
    maxIterations = PPR_MAX_ITERATIONS,
    tolerance = PPR_TOLERANCE,
  } = input;

  const nodeCount = offsets.length - 1;
  const empty = new Float64Array(nodeCount);
  const emptyResult: QueryPropagationResult = {
    relevance: empty,
    positiveRelevance: empty,
    negativeRelevance: null,
    authority: empty,
    precision: empty,
    expectedInfo: empty,
    iterations: { relevance: 0, authority: 0 },
  };

  if (seedIndices.length === 0 && negativeSeedIndices.length === 0) {
    return emptyResult;
  }

  const unsignedGraph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    [],
    rowOutFractions,
  );
  const params: PropagationParams = { alpha, maxIterations, tolerance };

  const priorCsr = buildPriorCsrView(input);
  const priorLog = buildPriorLog(priorCsr);

  const initialAuthority = runAuthorityPropagation(unsignedGraph, priorLog, params);
  const positiveRun = runUnsignedRelevance(
    unsignedGraph,
    seedIndices,
    initialAuthority.authority,
    params,
  );
  const negativeRun = runUnsignedRelevance(
    unsignedGraph,
    negativeSeedIndices,
    initialAuthority.authority,
    params,
  );
  const negativeRelevance =
    negativeSeedIndices.length > 0 ? negativeRun.relevance : null;
  const relevance = contrastRelevance(
    positiveRun.relevance,
    negativeRelevance,
    negativeLambda,
  );

  const tagPriorLog = computeTagPriorLogFromFlux({
    nodeCount,
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions: rowOutFractions ?? new Float64Array(nodeCount).fill(1),
    nodeKinds,
    tagIndices,
    relevance: positiveRun.relevance,
  });
  mergeTagPriorLog(priorLog, tagIndices, tagPriorLog);

  const refinedAuthority = runAuthorityPropagation(unsignedGraph, priorLog, params);
  const precision = computePrecision(unsignedGraph, priorLog, refinedAuthority.authority);
  const expectedInfo = computeExpectedInfo(
    relevance,
    refinedAuthority.authority,
    precision,
  );

  return {
    relevance,
    positiveRelevance: positiveRun.relevance,
    negativeRelevance,
    authority: refinedAuthority.authority,
    precision,
    expectedInfo,
    iterations: {
      relevance: positiveRun.iterations + negativeRun.iterations,
      authority: initialAuthority.iterations + refinedAuthority.iterations,
    },
  };
}

export function queryInputFromCsr(
  csr: PriorGraph & {
    offsets: number[];
    neighbors: number[];
    edgeWeights: number[];
    rowOutFractions: Float64Array;
  },
  seeds: {
    seedIndices: number[];
    negativeSeedIndices?: number[];
    negativeLambda?: number;
    alpha: number;
    maxIterations: number;
    tolerance: number;
  },
): Omit<QueryPropagationInputPayload, 'mode'> {
  const wordCounts = csr.nodeByIndex.map((node) => node.wordCount ?? null);
  const nodeKinds = csr.nodeByIndex.map((node) => node.kind);
  return {
    offsets: csr.offsets,
    neighbors: csr.neighbors,
    edgeWeights: csr.edgeWeights,
    rowOutFractions: [...csr.rowOutFractions],
    workIndices: csr.workIndices,
    tagIndices: csr.tagIndices,
    authorIndices: csr.authorIndices,
    authorWorkIndexEdges: csr.authorWorkIndexEdges,
    wordCounts,
    nodeKinds,
    ...seeds,
  };
}
