import { pageRankUpdateRule } from '../rules/pageRankStep';
import type { SignalInstance, SignalUpdateRule } from '../types';

export const AUTHORITY_SIGNAL_ID = 'authority';

export const authorityUpdateRule: SignalUpdateRule = pageRankUpdateRule;

export function createAuthoritySignal(
  nodeCount: number,
  teleport: Float64Array,
): SignalInstance {
  return {
    id: AUTHORITY_SIGNAL_ID,
    state: new Float64Array(nodeCount),
    teleport,
    buffer: new Float64Array(nodeCount),
    rule: authorityUpdateRule,
  };
}
