import type { ExpansionPolicyContext } from '../expansionPolicy';
import { extractNeighborhoods, type Hypothesis } from './neighborhoods';
import { buildHypothesisPoset, type HypothesisPoset } from './poset';
import { computeHasseHomology, type TopologyInvariants } from './orderComplex';
import { computeFragilityAll } from './fragility';
import type { ConductanceField } from './conductance';

export interface TopologyPipelineResult {
  field: ConductanceField;
  hypotheses: Hypothesis[];
  poset: HypothesisPoset;
  topology: TopologyInvariants;
  fragility: Float64Array;
  rowOutFractions: Float64Array | number[];
}

/** Shared conductance → neighborhoods → poset → homology → fragility pipeline. */
export function runTopologyPipeline(ctx: ExpansionPolicyContext): TopologyPipelineResult {
  const rowOutFractions = ctx.rowOutFractions ?? ctx.csr.rowOutFractions;
  const extraction = extractNeighborhoods(ctx.csr, ctx.relevance, ctx.authority, {
    rowOutFractions,
  });
  const poset = buildHypothesisPoset(extraction.hypotheses);
  const topology = computeHasseHomology(poset);
  const fragility = computeFragilityAll({
    csr: ctx.csr,
    field: extraction.field,
    hypotheses: extraction.hypotheses,
    poset,
    topology,
    rowOutFractions,
  });
  return {
    field: extraction.field,
    hypotheses: extraction.hypotheses,
    poset,
    topology,
    fragility,
    rowOutFractions,
  };
}
