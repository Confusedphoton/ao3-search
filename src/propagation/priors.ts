import { GLOBAL_MEDIAN_WORD_COUNT, TAG_PRIOR_FALLBACK_LOG } from '../config/constants';
import { NodeKind } from '../graph/types';

export interface PriorGraph {
  nodeCount: number;
  workIndices: number[];
  tagIndices: number[];
  authorIndices: number[];
  authorWorkIndexEdges: Array<{ workIndex: number; authorIndex: number }>;
  nodeByIndex: Array<{ kind: NodeKind; wordCount: number | null }>;
}

export function workPriorLog(wordCount: number | null | undefined): number {
  if (wordCount == null || wordCount <= 0) return 0;
  return Math.log(wordCount / GLOBAL_MEDIAN_WORD_COUNT);
}

export function computeWorkPriorLog(graph: PriorGraph): Float64Array {
  const priorLog = new Float64Array(graph.nodeCount);
  for (const index of graph.workIndices) {
    priorLog[index] = workPriorLog(graph.nodeByIndex[index].wordCount);
  }
  return priorLog;
}

export function computeAuthorPriorLog(
  graph: PriorGraph,
  workPriorLog: Float64Array,
): Float64Array {
  const priorLog = new Float64Array(graph.nodeCount);
  for (const { workIndex, authorIndex } of graph.authorWorkIndexEdges) {
    const workMass = Math.exp(workPriorLog[workIndex]);
    const current = Math.exp(priorLog[authorIndex]) - 1;
    priorLog[authorIndex] = Math.log(1 + current + workMass);
  }
  return priorLog;
}

export function buildPriorLog(graph: PriorGraph): Float64Array {
  const workLog = computeWorkPriorLog(graph);
  const authorLog = computeAuthorPriorLog(graph, workLog);
  const priorLog = new Float64Array(graph.nodeCount);

  for (let index = 0; index < graph.nodeCount; index++) {
    const node = graph.nodeByIndex[index];
    if (node.kind === NodeKind.Work) {
      priorLog[index] = workLog[index];
    } else if (node.kind === NodeKind.Author) {
      priorLog[index] = authorLog[index];
    } else {
      priorLog[index] = TAG_PRIOR_FALLBACK_LOG;
    }
  }

  return priorLog;
}

export function buildTeleportFromPriorLog(priorLog: Float64Array): Float64Array {
  const teleport = new Float64Array(priorLog.length);
  let sum = 0;
  for (let i = 0; i < priorLog.length; i++) {
    const weight = Math.exp(priorLog[i]);
    teleport[i] = weight;
    sum += weight;
  }
  if (sum <= 0) {
    const uniform = 1 / priorLog.length;
    teleport.fill(uniform);
    return teleport;
  }
  for (let i = 0; i < teleport.length; i++) teleport[i] /= sum;
  return teleport;
}

export function mergeTagPriorLog(
  priorLog: Float64Array,
  tagIndices: number[],
  tagPriorLog: Float64Array,
): void {
  for (let i = 0; i < tagIndices.length; i++) {
    priorLog[tagIndices[i]] = tagPriorLog[i];
  }
}
