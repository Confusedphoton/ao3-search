import { NEGATIVE_SEED_WEIGHT } from '../../config/constants';
import { pageRankUpdateRule } from '../rules/pageRankStep';
import type { SeedContext, SignalInstance, SignalUpdateRule } from '../types';

export const RELEVANCE_SIGNAL_ID = 'relevance';
/** @deprecated Use RELEVANCE_SIGNAL_ID */
export const RANK_SIGNAL_ID = RELEVANCE_SIGNAL_ID;

export function buildRankTeleport(context: SeedContext): Float64Array {
  const teleport = new Float64Array(context.nodeCount);

  if (context.seedIndices.length > 0) {
    const positiveWeight = 1 / context.seedIndices.length;
    for (const index of context.seedIndices) {
      teleport[index] += positiveWeight;
    }
  }

  if (context.negativeSeedIndices.length > 0) {
    const sinkWeight = context.negativeWeight / context.negativeSeedIndices.length;
    for (const index of context.negativeSeedIndices) {
      teleport[index] -= sinkWeight;
    }
  }

  return teleport;
}

export const rankUpdateRule: SignalUpdateRule = pageRankUpdateRule;

export function createRankSignal(context: SeedContext): SignalInstance {
  const nodeCount = context.nodeCount;
  return {
    id: RELEVANCE_SIGNAL_ID,
    state: new Float64Array(nodeCount),
    teleport: buildRankTeleport(context),
    buffer: new Float64Array(nodeCount),
    rule: rankUpdateRule,
  };
}

export function createRankSeedContext(
  nodeCount: number,
  seedIndices: number[],
  negativeSeedIndices: number[] = [],
  negativeWeight: number = NEGATIVE_SEED_WEIGHT,
): SeedContext {
  return { nodeCount, seedIndices, negativeSeedIndices, negativeWeight };
}
