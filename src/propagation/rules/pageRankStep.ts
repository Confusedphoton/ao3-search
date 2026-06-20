import type { PropagationParams, SignalUpdateRule } from '../types';

export function l1Normalize(state: Float64Array): void {
  let norm = 0;
  for (let i = 0; i < state.length; i++) norm += Math.abs(state[i]);
  if (norm <= 0) return;
  for (let i = 0; i < state.length; i++) state[i] /= norm;
}

export function applyPageRankStep(
  state: Float64Array,
  spread: Float64Array,
  teleport: Float64Array,
  params: PropagationParams,
): number {
  const { alpha } = params;
  let delta = 0;

  for (let i = 0; i < state.length; i++) {
    const value = (1 - alpha) * spread[i] + alpha * teleport[i];
    delta += Math.abs(value - state[i]);
    state[i] = value;
  }

  l1Normalize(state);

  return delta;
}

export const pageRankUpdateRule: SignalUpdateRule = {
  applyIteration: applyPageRankStep,
};
