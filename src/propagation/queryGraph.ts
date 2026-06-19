import type { CSRGraph } from '../graph/csr';
import {
  signEdgesForNegativeSeeds,
  signEdgesForNegativeSeedsFromCsr,
} from '../graph/signedQuery';
import type { PropagationGraph } from './types';

export function buildPropagationGraph(
  csr: CSRGraph,
  negativeSeedIndices: number[],
): PropagationGraph {
  return {
    nodeCount: csr.nodeCount,
    offsets: csr.offsets,
    neighbors: csr.neighbors,
    transitionWeights: signEdgesForNegativeSeedsFromCsr(csr, negativeSeedIndices),
  };
}

export function buildPropagationGraphFromArrays(
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
  negativeSeedIndices: number[] = [],
): PropagationGraph {
  return {
    nodeCount: offsets.length - 1,
    offsets,
    neighbors,
    transitionWeights: signEdgesForNegativeSeeds(
      offsets,
      neighbors,
      edgeWeights,
      negativeSeedIndices,
    ),
  };
}
