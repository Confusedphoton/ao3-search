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
 * Discrete superlevel thresholds: at most `maxLevels` values sampled uniformly
 * across the positive φ range, always including max φ.
 */
export function thresholdSchedule(
  phi: Float64Array,
  maxLevels: number = TOPOLOGY_MAX_LEVELS,
): number[] {
  let maxPhi = 0;
  let minPositive = Infinity;
  for (let i = 0; i < phi.length; i++) {
    const value = phi[i]!;
    if (value > maxPhi) maxPhi = value;
    if (value > 0 && value < minPositive) minPositive = value;
  }
  if (maxPhi <= 0 || !Number.isFinite(maxPhi)) return [];
  if (!Number.isFinite(minPositive) || minPositive >= maxPhi) {
    return [maxPhi];
  }

  const levels = Math.max(1, Math.min(maxLevels, phi.length));
  if (levels === 1) return [maxPhi];

  const out: number[] = [];
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    // High → low so filtration grows as λ decreases.
    out.push(maxPhi - t * (maxPhi - minPositive));
  }
  return out;
}
