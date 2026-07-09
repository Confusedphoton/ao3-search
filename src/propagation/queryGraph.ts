import type { CSRGraph } from '../graph/csr';
import {
  signEdgesForNegativeSeeds,
  signEdgesForNegativeSeedsFromCsr,
} from '../graph/signedQuery';
import { applyPermeabilityFilter } from './permeability';
import type { PropagationGraph } from './types';

function defaultRowOutFractions(nodeCount: number): Float64Array {
  return new Float64Array(nodeCount).fill(1);
}

export function buildTransitionWeights(
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
  rowOutFractions: Float64Array | number[],
  negativeSeedIndices: number[] = [],
  nodePermeabilities?: Float64Array | number[],
): number[] {
  const signed = signEdgesForNegativeSeeds(
    offsets,
    neighbors,
    edgeWeights,
    negativeSeedIndices,
  );
  const transition = signed.slice();
  const nodeCount = offsets.length - 1;

  for (let node = 0; node < nodeCount; node++) {
    const start = offsets[node];
    const end = offsets[node + 1];
    if (start === end) continue;

    let sum = 0;
    for (let edge = start; edge < end; edge++) sum += Math.abs(signed[edge]);
    if (sum <= 0) continue;

    const scale = rowOutFractions[node] / sum;
    for (let edge = start; edge < end; edge++) {
      transition[edge] = signed[edge] * scale;
    }
  }

  if (nodePermeabilities) {
    applyPermeabilityFilter(offsets, neighbors, transition, nodePermeabilities);
  }

  return transition;
}

export function buildPropagationGraph(
  csr: CSRGraph,
  negativeSeedIndices: number[],
  nodePermeabilities?: Float64Array | number[],
): PropagationGraph {
  return {
    nodeCount: csr.nodeCount,
    offsets: csr.offsets,
    neighbors: csr.neighbors,
    transitionWeights: buildTransitionWeights(
      csr.offsets,
      csr.neighbors,
      csr.edgeWeights,
      csr.rowOutFractions,
      negativeSeedIndices,
      nodePermeabilities,
    ),
  };
}

export function buildPropagationGraphFromArrays(
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
  negativeSeedIndices: number[] = [],
  rowOutFractions?: Float64Array | number[],
  nodePermeabilities?: Float64Array | number[],
): PropagationGraph {
  const nodeCount = offsets.length - 1;
  return {
    nodeCount,
    offsets,
    neighbors,
    transitionWeights: buildTransitionWeights(
      offsets,
      neighbors,
      edgeWeights,
      rowOutFractions ?? defaultRowOutFractions(nodeCount),
      negativeSeedIndices,
      nodePermeabilities,
    ),
  };
}

export { signEdgesForNegativeSeedsFromCsr };
