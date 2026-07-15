import { TOPOLOGY_H1_FRAGILITY_BOOST } from '../../config/constants';
import type { CSRGraph } from '../../graph/csr';
import type { ConductanceField } from './conductance';
import { hypothesisBoundaryNodes, type Hypothesis } from './neighborhoods';
import type { HypothesisPoset } from './poset';
import type { TopologyInvariants } from './orderComplex';

/**
 * boundaryExposure(v) = (1 − ρ_v) · Σ_{u∼v, u∈∂H} C(u,v)
 */
export function boundaryExposure(
  csr: CSRGraph,
  field: ConductanceField,
  index: number,
  boundary: Set<number>,
  rowOutFractions: Float64Array | number[],
): number {
  const rho = rowOutFractions[index] ?? 1;
  const openness = Math.max(0, 1 - rho);
  if (openness <= 0) return 0;

  let sum = 0;
  const begin = csr.offsets[index]!;
  const end = csr.offsets[index + 1]!;
  for (let e = begin; e < end; e++) {
    const u = csr.neighbors[e]!;
    if (!boundary.has(u)) continue;
    sum += field.edgeConductance[e] ?? 0;
  }
  return openness * sum;
}

/**
 * potentialInfluence(v) = φ(v) · (1 + deg_C(v))
 */
export function potentialInfluence(field: ConductanceField, index: number): number {
  return (field.phi[index] ?? 0) * (1 + (field.degreeC[index] ?? 0));
}

/**
 * Hypotheses that participate in Hasse cycles (non-tree edges / multi-path structure).
 * Heuristic: any hypothesis with degree ≥ 2 in the undirected Hasse graph when β₁ > 0,
 * else empty.
 */
export function h1RelevantHypothesisIds(
  poset: HypothesisPoset,
  topology: TopologyInvariants,
): Set<number> {
  const relevant = new Set<number>();
  if (topology.beta1 <= 0) return relevant;

  const degree = new Map<number, number>();
  for (const h of poset.hypotheses) degree.set(h.id, 0);
  for (const edge of poset.covers) {
    degree.set(edge.lower, (degree.get(edge.lower) ?? 0) + 1);
    degree.set(edge.upper, (degree.get(edge.upper) ?? 0) + 1);
  }
  for (const [id, deg] of degree) {
    if (deg >= 2) relevant.add(id);
  }
  return relevant;
}

export function nodeIncidentsH1(
  index: number,
  hypotheses: Hypothesis[],
  h1Ids: Set<number>,
): boolean {
  if (h1Ids.size === 0) return false;
  for (const h of hypotheses) {
    if (!h1Ids.has(h.id)) continue;
    // nodes are sorted; binary-ish linear scan is fine at our caps
    let lo = 0;
    let hi = h.nodes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = h.nodes[mid]!;
      if (v === index) return true;
      if (v < index) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return false;
}

export interface FragilityContext {
  csr: CSRGraph;
  field: ConductanceField;
  hypotheses: Hypothesis[];
  poset: HypothesisPoset;
  topology: TopologyInvariants;
  rowOutFractions: Float64Array | number[];
}

export function computeFragility(ctx: FragilityContext, index: number): number {
  const boundary = hypothesisBoundaryNodes(ctx.csr, ctx.hypotheses);
  const exposure = boundaryExposure(
    ctx.csr,
    ctx.field,
    index,
    boundary,
    ctx.rowOutFractions,
  );
  const influence = potentialInfluence(ctx.field, index);
  let fragility = exposure * influence;

  const h1Ids = h1RelevantHypothesisIds(ctx.poset, ctx.topology);
  if (nodeIncidentsH1(index, ctx.hypotheses, h1Ids)) {
    fragility *= TOPOLOGY_H1_FRAGILITY_BOOST;
  }
  return fragility;
}

/** Vector of fragility scores for all nodes (0 for non-scored). */
export function computeFragilityAll(ctx: FragilityContext): Float64Array {
  const out = new Float64Array(ctx.csr.nodeCount);
  const boundary = hypothesisBoundaryNodes(ctx.csr, ctx.hypotheses);
  const h1Ids = h1RelevantHypothesisIds(ctx.poset, ctx.topology);

  for (let index = 0; index < ctx.csr.nodeCount; index++) {
    const exposure = boundaryExposure(
      ctx.csr,
      ctx.field,
      index,
      boundary,
      ctx.rowOutFractions,
    );
    const influence = potentialInfluence(ctx.field, index);
    let fragility = exposure * influence;
    if (nodeIncidentsH1(index, ctx.hypotheses, h1Ids)) {
      fragility *= TOPOLOGY_H1_FRAGILITY_BOOST;
    }
    out[index] = fragility;
  }
  return out;
}
