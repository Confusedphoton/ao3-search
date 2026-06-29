import {
  NEGATIVE_SEED_WEIGHT,
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
  negativeWeight?: number;
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
  relevance: Float64Array;
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

function runRelevancePropagation(
  graph: ReturnType<typeof buildPropagationGraphFromArrays>,
  seedIndices: number[],
  negativeSeedIndices: number[],
  negativeWeight: number,
  authority: Float64Array,
  params: PropagationParams,
): { relevance: Float64Array; iterations: number } {
  const context = createSeedContext(
    graph.nodeCount,
    seedIndices,
    negativeSeedIndices,
    negativeWeight,
  );
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
    negativeWeight = NEGATIVE_SEED_WEIGHT,
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
  const signedGraph = buildPropagationGraphFromArrays(
    offsets,
    neighbors,
    edgeWeights,
    negativeSeedIndices,
    rowOutFractions,
  );
  const params: PropagationParams = { alpha, maxIterations, tolerance };

  const priorCsr = buildPriorCsrView(input);
  const priorLog = buildPriorLog(priorCsr);

  const initialAuthority = runAuthorityPropagation(unsignedGraph, priorLog, params);
  const relevanceRun = runRelevancePropagation(
    signedGraph,
    seedIndices,
    negativeSeedIndices,
    negativeWeight,
    initialAuthority.authority,
    params,
  );

  const tagPriorLog = computeTagPriorLogFromFlux({
    nodeCount,
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions: rowOutFractions ?? new Float64Array(nodeCount).fill(1),
    nodeKinds,
    tagIndices,
    relevance: relevanceRun.relevance,
  });
  mergeTagPriorLog(priorLog, tagIndices, tagPriorLog);

  const refinedAuthority = runAuthorityPropagation(unsignedGraph, priorLog, params);
  const precision = computePrecision(unsignedGraph, priorLog, refinedAuthority.authority);
  const expectedInfo = computeExpectedInfo(
    relevanceRun.relevance,
    refinedAuthority.authority,
    precision,
  );

  return {
    relevance: relevanceRun.relevance,
    authority: refinedAuthority.authority,
    precision,
    expectedInfo,
    iterations: {
      relevance: relevanceRun.iterations,
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
    negativeWeight?: number;
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