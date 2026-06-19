import { pageRankUpdateRule } from '../rules/pageRankStep';
import type { SeedContext, SignalInstance, SignalUpdateRule } from '../types';

export const CONFIDENCE_SIGNAL_ID = 'confidence';

/** Placeholder until confidence gets its own update rule and teleport policy. */
export function buildConfidenceTeleport(context: SeedContext): Float64Array {
  return new Float64Array(context.nodeCount);
}

export const confidenceUpdateRule: SignalUpdateRule = pageRankUpdateRule;

export function createConfidenceSignal(context: SeedContext): SignalInstance {
  const nodeCount = context.nodeCount;
  return {
    id: CONFIDENCE_SIGNAL_ID,
    state: new Float64Array(nodeCount),
    teleport: buildConfidenceTeleport(context),
    buffer: new Float64Array(nodeCount),
    rule: confidenceUpdateRule,
  };
}
