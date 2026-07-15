import type { HypothesisPoset } from './poset';

export interface TopologyInvariants {
  beta0: number;
  beta1: number;
  vertexCount: number;
  edgeCount: number;
}

/**
 * Dim-0/1 homology of the Hasse diagram as an undirected graph.
 * β₀ = connected components; β₁ = |E| − |V| + β₀.
 *
 * Note: this is the 1-skeleton (covering relations) approximation of the
 * order complex; full chain-complex H₁ is a follow-up if needed.
 */
export function computeHasseHomology(poset: HypothesisPoset): TopologyInvariants {
  const { hypotheses, covers } = poset;
  const vertexCount = hypotheses.length;
  if (vertexCount === 0) {
    return { beta0: 0, beta1: 0, vertexCount: 0, edgeCount: 0 };
  }

  const idToIndex = new Map(hypotheses.map((h, i) => [h.id, i]));
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (cur !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Deduplicate undirected covering edges.
  const undirected = new Set<string>();
  for (const edge of covers) {
    const i = idToIndex.get(edge.lower);
    const j = idToIndex.get(edge.upper);
    if (i === undefined || j === undefined || i === j) continue;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    undirected.add(`${a}:${b}`);
  }

  for (const key of undirected) {
    const [aStr, bStr] = key.split(':');
    union(Number(aStr), Number(bStr));
  }

  const roots = new Set<number>();
  for (let i = 0; i < vertexCount; i++) roots.add(find(i));
  const beta0 = roots.size;
  const edgeCount = undirected.size;
  const beta1 = Math.max(0, edgeCount - vertexCount + beta0);

  return { beta0, beta1, vertexCount, edgeCount };
}

export function topologyIsTrivial(topo: TopologyInvariants): boolean {
  return topo.beta0 <= 1 && topo.beta1 === 0;
}

export function topologyEquals(a: TopologyInvariants, b: TopologyInvariants): boolean {
  return a.beta0 === b.beta0 && a.beta1 === b.beta1;
}

/**
 * Tracks consecutive identical trivial topology snapshots for early stopping.
 */
export class TopologyStabilityTracker {
  private last: TopologyInvariants | null = null;
  private stableCount = 0;
  private readonly requiredIters: number;

  constructor(requiredIters: number) {
    this.requiredIters = Math.max(1, requiredIters);
  }

  /** Returns true when topology has been trivial and unchanged for requiredIters updates. */
  update(topo: TopologyInvariants): boolean {
    if (this.last && topologyEquals(this.last, topo) && topologyIsTrivial(topo)) {
      this.stableCount += 1;
    } else {
      this.stableCount = topologyIsTrivial(topo) ? 1 : 0;
    }
    this.last = topo;
    return this.stableCount >= this.requiredIters;
  }

  reset(): void {
    this.last = null;
    this.stableCount = 0;
  }
}
