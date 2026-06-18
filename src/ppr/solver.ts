import {
  PPR_ALPHA,
  PPR_MAX_ITERATIONS,
  PPR_TOLERANCE,
} from '../config/constants';

export interface PPRInput {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  seedIndices: number[];
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
  const {
    offsets,
    neighbors,
    edgeWeights,
    seedIndices,
    alpha = PPR_ALPHA,
    maxIterations = PPR_MAX_ITERATIONS,
    tolerance = PPR_TOLERANCE,
  } = input;

  const n = offsets.length - 1;
  const authority = new Float64Array(n);
  const next = new Float64Array(n);
  const teleport = new Float64Array(n);

  if (seedIndices.length === 0) {
    return { authority, iterations: 0, delta: 0 };
  }

  const seedWeight = 1 / seedIndices.length;
  for (const index of seedIndices) {
    teleport[index] = seedWeight;
  }

  authority.fill(1 / n);

  let iterations = 0;
  let delta = Infinity;

  while (iterations < maxIterations && delta > tolerance) {
    next.fill(0);

    for (let node = 0; node < n; node++) {
      const start = offsets[node];
      const end = offsets[node + 1];
      const mass = authority[node];
      if (mass === 0 || start === end) continue;

      for (let edge = start; edge < end; edge++) {
        next[neighbors[edge]] += mass * edgeWeights[edge];
      }
    }

    delta = 0;
    for (let i = 0; i < n; i++) {
      const value = (1 - alpha) * next[i] + alpha * teleport[i];
      delta += Math.abs(value - authority[i]);
      authority[i] = value;
    }

    iterations++;
  }

  return { authority, iterations, delta };
}

export function topWorkIndices(
  authority: Float64Array,
  workIndices: number[],
  limit: number,
): Array<{ index: number; score: number }> {
  const ranked = workIndices
    .map((index) => ({ index, score: authority[index] }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
