import { TAG_FLUX_EPS } from '../config/constants';
import { NodeKind } from '../graph/types';
import { buildTransitionWeights } from './queryGraph';

export interface TagFluxInput {
  nodeCount: number;
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions: Float64Array | number[];
  nodeKinds: NodeKind[];
  tagIndices: number[];
  relevance: Float64Array;
}

export function computeTagPriorLogFromFlux(input: TagFluxInput): Float64Array {
  const {
    nodeCount,
    offsets,
    neighbors,
    edgeWeights,
    rowOutFractions,
    nodeKinds,
    tagIndices,
    relevance,
  } = input;

  const transition = buildTransitionWeights(offsets, neighbors, edgeWeights, rowOutFractions);
  const boundaryFlux = new Float64Array(nodeCount);
  const internalFlux = new Float64Array(nodeCount);

  for (let u = 0; u < nodeCount; u++) {
    const mass = relevance[u];
    if (mass === 0) continue;

    const start = offsets[u];
    const end = offsets[u + 1];
    const uIsTag = nodeKinds[u] === NodeKind.Tag;

    for (let edge = start; edge < end; edge++) {
      const v = neighbors[edge];
      const flow = mass * transition[edge];
      const vIsTag = nodeKinds[v] === NodeKind.Tag;

      if (!uIsTag && vIsTag) {
        boundaryFlux[v] += flow;
      } else if (uIsTag && vIsTag) {
        internalFlux[v] += flow;
      }
    }
  }

  const tagPriorLog = new Float64Array(tagIndices.length);
  for (let i = 0; i < tagIndices.length; i++) {
    const index = tagIndices[i];
    const flux = boundaryFlux[index];
    const internal = internalFlux[index];
    const coherence = flux / (flux + internal + TAG_FLUX_EPS);
    tagPriorLog[i] = Math.log(coherence + TAG_FLUX_EPS);
  }

  return tagPriorLog;
}
