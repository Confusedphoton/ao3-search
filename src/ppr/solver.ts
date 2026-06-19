import { runRankPropagation, topWorkIndices as topWorkIndicesFromPropagation } from '../propagation';

export interface PPRInput {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  seedIndices: number[];
  negativeSeedIndices?: number[];
  negativeWeight?: number;
  alpha?: number;
  maxIterations?: number;
  tolerance?: number;
}

export interface PPRResult {
  authority: Float64Array;
  iterations: number;
  delta: number;
}

export function runPPR(input: PPRInput): PPRResult {
  return runRankPropagation(input);
}

export function topWorkIndices(
  authority: Float64Array,
  workIndices: number[],
  limit: number,
): Array<{ index: number; score: number }> {
  return topWorkIndicesFromPropagation(authority, workIndices, limit);
}
