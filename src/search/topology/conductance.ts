import type { CSRGraph } from '../../graph/csr';
import { TOPOLOGY_MAX_LEVELS } from '../../config/constants';

export interface ConductanceField {
  phi: Float64Array;
  /** Parallel to `csr.neighbors` / `csr.edgeWeights`. */
  edgeConductance: Float64Array;
  /** Sum of edge conductances incident to each node. */
  degreeC: Float64Array;
}

/** φ(v) = √(max(R,0) · max(A,0)). */
export function nodePotential(relevance: number, authority: number): number {
  return Math.sqrt(Math.max(relevance, 0) * Math.max(authority, 0));
}

/**
 * Build the conductance-weighted potential field on the observed CSR.
 * Edge conductance C(u,v) = √(R(u)R(v)) √(A(u)A(v)) = φ(u)·φ(v).
 */
export function buildConductanceField(
  csr: CSRGraph,
  relevance: Float64Array | number[],
  authority: Float64Array | number[],
): ConductanceField {
  const n = csr.nodeCount;
  const phi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phi[i] = nodePotential(relevance[i] ?? 0, authority[i] ?? 0);
  }

  const edgeConductance = new Float64Array(csr.neighbors.length);
  const degreeC = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    const start = csr.offsets[u]!;
    const end = csr.offsets[u + 1]!;
    let deg = 0;
    for (let e = start; e < end; e++) {
      const v = csr.neighbors[e]!;
      const c = phi[u]! * phi[v]!;
      edgeConductance[e] = c;
      deg += c;
    }
    degreeC[u] = deg;
  }

  return { phi, edgeConductance, degreeC };
}

/**
 * Discrete superlevel thresholds sampled from positive φ critical values.
 */
export function thresholdSchedule(
  phi: Float64Array,
  maxLevels: number = TOPOLOGY_MAX_LEVELS,
): number[] {
  const uniquePositive = new Set<number>();
  for (let i = 0; i < phi.length; i++) {
    const value = phi[i]!;
    if (value > 0 && Number.isFinite(value)) uniquePositive.add(value);
  }
  const criticalValues = [...uniquePositive].sort((a, b) => b - a);
  if (criticalValues.length === 0) return [];

  const levels = Math.max(1, Math.min(maxLevels, criticalValues.length));
  if (levels === 1) return [criticalValues[0]!];

  const out: number[] = [];
  for (let i = 0; i < levels; i++) {
    const index = Math.round((i * (criticalValues.length - 1)) / (levels - 1));
    out.push(criticalValues[index]!);
  }
  return out;
}
