/** Discounted cumulative gain for graded relevance gains. */
export function dcgAtK(gains: number[], k: number): number {
  const limit = Math.min(k, gains.length);
  let score = 0;
  for (let rank = 0; rank < limit; rank++) {
    const gain = gains[rank];
    if (gain <= 0) continue;
    score += gain / Math.log2(rank + 2);
  }
  return score;
}

/**
 * NDCG@K for a predicted ranking against graded ground-truth gains.
 * `predictedKeys` is ordered best-first. Missing keys contribute 0 gain.
 */
export function ndcgAtK(
  predictedKeys: string[],
  gainByKey: Map<string, number>,
  k: number,
): number {
  if (k <= 0) return 0;

  const predictedGains = predictedKeys.slice(0, k).map((key) => gainByKey.get(key) ?? 0);
  const dcg = dcgAtK(predictedGains, k);

  const idealGains = [...gainByKey.values()]
    .filter((gain) => gain > 0)
    .sort((a, b) => b - a);
  const idcg = dcgAtK(idealGains, k);
  if (idcg <= 0) return 0;
  return dcg / idcg;
}

/** Mean of NDCG@K over a sweep of cutoffs. */
export function meanNdcgAtKs(
  predictedKeys: string[],
  gainByKey: Map<string, number>,
  ks: number[],
): number {
  if (ks.length === 0) return 0;
  let sum = 0;
  for (const k of ks) {
    sum += ndcgAtK(predictedKeys, gainByKey, k);
  }
  return sum / ks.length;
}
