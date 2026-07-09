export interface PropagationGraph {
  nodeCount: number;
  offsets: number[];
  neighbors: number[];
  transitionWeights: number[];
}

export interface PropagationParams {
  alpha: number;
  maxIterations: number;
  tolerance: number;
}

export interface SignalUpdateRule {
  applyIteration(
    state: Float64Array,
    spread: Float64Array,
    teleport: Float64Array,
    params: PropagationParams,
  ): number;
}

export interface SignalInstance {
  id: string;
  state: Float64Array;
  teleport: Float64Array;
  buffer: Float64Array;
  rule: SignalUpdateRule;
  receiverWeights?: Float64Array;
}

export interface PropagationResult {
  signals: Record<string, Float64Array>;
  iterations: number;
  deltas: Record<string, number>;
}

export interface SeedContext {
  nodeCount: number;
  seedIndices: number[];
  /** Retained for callers; dual-PPR contrast applies negatives outside teleport. */
  negativeSeedIndices: number[];
}
