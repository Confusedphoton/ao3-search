import { isStrictSubset, isSubset, type Hypothesis } from './neighborhoods';

export interface HasseEdge {
  /** Smaller hypothesis (refinement). */
  lower: number;
  /** Larger hypothesis (coarser). */
  upper: number;
}

export interface HypothesisPoset {
  hypotheses: Hypothesis[];
  /** Covering relations: lower ⊂ upper with no intermediate. */
  covers: HasseEdge[];
  height: number;
  width: number;
}

/**
 * Build the inclusion poset and its Hasse diagram (covering relations only).
 */
export function buildHypothesisPoset(hypotheses: Hypothesis[]): HypothesisPoset {
  const n = hypotheses.length;
  const covers: HasseEdge[] = [];

  // Proper inclusion matrix (i ⊂ j).
  const proper: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (isStrictSubset(hypotheses[i]!.nodes, hypotheses[j]!.nodes)) {
        proper[i]![j] = true;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!proper[i]![j]) continue;
      let covered = true;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        if (proper[i]![k] && proper[k]![j]) {
          covered = false;
          break;
        }
      }
      if (covered) {
        covers.push({ lower: hypotheses[i]!.id, upper: hypotheses[j]!.id });
      }
    }
  }

  const idToIndex = new Map(hypotheses.map((h, idx) => [h.id, idx]));
  const children: number[][] = Array.from({ length: n }, () => []);
  for (const edge of covers) {
    const li = idToIndex.get(edge.lower);
    const ui = idToIndex.get(edge.upper);
    if (li === undefined || ui === undefined) continue;
    children[ui]!.push(li);
  }

  // Height = longest chain length (edges) in the Hasse DAG.
  const memo = new Map<number, number>();
  const chainFrom = (idx: number): number => {
    const cached = memo.get(idx);
    if (cached !== undefined) return cached;
    let best = 0;
    for (const child of children[idx]!) {
      best = Math.max(best, 1 + chainFrom(child));
    }
    memo.set(idx, best);
    return best;
  };
  let height = 0;
  for (let i = 0; i < n; i++) height = Math.max(height, chainFrom(i));

  // Width ≈ size of largest antichain proxy: max nodes at same inclusion rank.
  const rank = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let j = 0; j < n; j++) {
      if (proper[j]![i]) r++;
    }
    rank[i] = r;
  }
  const rankCounts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = rank[i]!;
    rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  }
  let width = 0;
  for (const count of rankCounts.values()) width = Math.max(width, count);
  if (n > 0 && width === 0) width = n;

  return { hypotheses, covers, height, width };
}

/** True if hypothesis `a` refines (is ⊆) hypothesis `b`. */
export function refines(a: Hypothesis, b: Hypothesis): boolean {
  return isSubset(a.nodes, b.nodes);
}
