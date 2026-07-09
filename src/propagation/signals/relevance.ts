import { pageRankUpdateRule } from '../rules/pageRankStep';
import type { SeedContext, SignalInstance, SignalUpdateRule } from '../types';

export const RELEVANCE_SIGNAL_ID = 'relevance';

export function buildRelevanceTeleport(context: SeedContext): Float64Array {
  const teleport = new Float64Array(context.nodeCount);

  if (context.seedIndices.length > 0) {
    const positiveWeight = 1 / context.seedIndices.length;
    for (const index of context.seedIndices) {
      teleport[index] += positiveWeight;
    }
  }

  return teleport;
}

/**
 * Contrast positive and negative Personalized PageRank into a ranking score:
 * score = r⁺ − λ r⁻.
 */
export function contrastRelevance(
  positiveRelevance: Float64Array,
  negativeRelevance: Float64Array | null,
  lambda: number,
): Float64Array {
  if (!negativeRelevance || lambda === 0) {
    return positiveRelevance;
  }

  const score = new Float64Array(positiveRelevance.length);
  for (let i = 0; i < score.length; i++) {
    score[i] = positiveRelevance[i] - lambda * negativeRelevance[i];
  }
  return score;
}

export const relevanceUpdateRule: SignalUpdateRule = pageRankUpdateRule;

export function createRelevanceSignal(context: SeedContext): SignalInstance {
  const nodeCount = context.nodeCount;
  return {
    id: RELEVANCE_SIGNAL_ID,
    state: new Float64Array(nodeCount),
    teleport: buildRelevanceTeleport(context),
    buffer: new Float64Array(nodeCount),
    rule: relevanceUpdateRule,
  };
}

export function createSeedContext(
  nodeCount: number,
  seedIndices: number[],
  negativeSeedIndices: number[] = [],
): SeedContext {
  return { nodeCount, seedIndices, negativeSeedIndices };
}
