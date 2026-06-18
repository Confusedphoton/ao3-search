import type { CSRGraph } from './csr';

/**
 * Query-layer signing: flip edge weights touching negative seed nodes.
 * Layer 2 CSR stays unsigned; this is applied per search.
 */
export function signEdgesForNegativeSeeds(
  offsets: number[],
  neighbors: number[],
  edgeWeights: number[],
  negativeSeedIndices: number[],
): number[] {
  if (negativeSeedIndices.length === 0) return edgeWeights;

  const negative = new Set(negativeSeedIndices);
  const signed = edgeWeights.slice();
  const nodeCount = offsets.length - 1;

  for (let node = 0; node < nodeCount; node++) {
    const start = offsets[node];
    const end = offsets[node + 1];
    const nodeIsNegative = negative.has(node);
    for (let edge = start; edge < end; edge++) {
      if (nodeIsNegative || negative.has(neighbors[edge])) {
        signed[edge] = -signed[edge];
      }
    }
  }

  return signed;
}

export function signEdgesForNegativeSeedsFromCsr(
  csr: CSRGraph,
  negativeSeedIndices: number[],
): number[] {
  return signEdgesForNegativeSeeds(
    csr.offsets,
    csr.neighbors,
    csr.edgeWeights,
    negativeSeedIndices,
  );
}
