import {
  TOPOLOGY_MAX_BOUNDARY_ALTS,
  TOPOLOGY_MAX_HYPOTHESES,
  TOPOLOGY_MAX_LEVELS,
} from '../../config/constants';
import type { CSRGraph } from '../../graph/csr';
import {
  buildConductanceField,
  thresholdSchedule,
  type ConductanceField,
} from './conductance';

export type HypothesisKind = 'superlevel' | 'boundary-alt';

export interface Hypothesis {
  id: number;
  /** Sorted ascending CSR node indices. */
  nodes: number[];
  /** Signature key for dedupe / inclusion. */
  key: string;
  /** Highest λ at which this set appears as a component (birth). */
  birth: number;
  /** Lowest λ at which this set still appears (death). */
  death: number;
  kind: HypothesisKind;
  /** Σ φ(v) over nodes. */
  mass: number;
}

export interface NeighborhoodExtraction {
  field: ConductanceField;
  hypotheses: Hypothesis[];
  thresholds: number[];
}

function componentKey(nodes: number[]): string {
  return nodes.join(',');
}

function componentMass(nodes: number[], phi: Float64Array): number {
  let mass = 0;
  for (const idx of nodes) mass += phi[idx] ?? 0;
  return mass;
}

/**
 * Connected components of the superlevel set {v : φ(v) ≥ λ}
 * using CSR edges with C(u,v) > 0.
 */
export function superlevelComponents(
  csr: CSRGraph,
  field: ConductanceField,
  lambda: number,
): number[][] {
  const n = csr.nodeCount;
  const inLevel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if ((field.phi[i] ?? 0) >= lambda) inLevel[i] = 1;
  }

  const visited = new Uint8Array(n);
  const components: number[][] = [];

  for (let start = 0; start < n; start++) {
    if (!inLevel[start] || visited[start]) continue;
    const nodes: number[] = [];
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const u = stack.pop()!;
      nodes.push(u);
      const begin = csr.offsets[u]!;
      const end = csr.offsets[u + 1]!;
      for (let e = begin; e < end; e++) {
        const v = csr.neighbors[e]!;
        if (!inLevel[v] || visited[v]) continue;
        if ((field.edgeConductance[e] ?? 0) <= 0) continue;
        visited[v] = 1;
        stack.push(v);
      }
    }
    nodes.sort((a, b) => a - b);
    components.push(nodes);
  }
  return components;
}

function persistenceScore(h: Hypothesis): number {
  return Math.max(0, h.birth - h.death) * h.mass + h.mass * 1e-12;
}

/**
 * Extract superlevel neighborhood hypotheses plus boundary-alternate variants.
 */
export function extractNeighborhoods(
  csr: CSRGraph,
  relevance: Float64Array | number[],
  authority: Float64Array | number[],
  options: {
    maxLevels?: number;
    maxHypotheses?: number;
    maxBoundaryAlts?: number;
    rowOutFractions?: Float64Array | number[];
  } = {},
): NeighborhoodExtraction {
  const maxLevels = options.maxLevels ?? TOPOLOGY_MAX_LEVELS;
  const maxHypotheses = options.maxHypotheses ?? TOPOLOGY_MAX_HYPOTHESES;
  const maxBoundaryAlts = options.maxBoundaryAlts ?? TOPOLOGY_MAX_BOUNDARY_ALTS;
  const field = buildConductanceField(csr, relevance, authority);
  const thresholds = thresholdSchedule(field.phi, maxLevels);

  const byKey = new Map<string, Hypothesis>();
  let nextId = 0;

  for (const lambda of thresholds) {
    for (const nodes of superlevelComponents(csr, field, lambda)) {
      if (nodes.length === 0) continue;
      const key = componentKey(nodes);
      const existing = byKey.get(key);
      if (existing) {
        existing.death = Math.min(existing.death, lambda);
        existing.birth = Math.max(existing.birth, lambda);
      } else {
        byKey.set(key, {
          id: nextId++,
          nodes,
          key,
          birth: lambda,
          death: lambda,
          kind: 'superlevel',
          mass: componentMass(nodes, field.phi),
        });
      }
    }
  }

  let hypotheses = [...byKey.values()];

  // Boundary-alternate variants: H ∪ {w} for open exterior neighbors of open components.
  const rowOut =
    options.rowOutFractions ?? csr.rowOutFractions ?? new Float64Array(csr.nodeCount).fill(1);
  const alts: Hypothesis[] = [];
  const existingKeys = new Set(byKey.keys());

  for (const h of hypotheses) {
    if (h.kind !== 'superlevel') continue;
    const member = new Set(h.nodes);
    const candidates: Array<{ w: number; score: number }> = [];

    for (const u of h.nodes) {
      const rhoU = rowOut[u] ?? 1;
      const begin = csr.offsets[u]!;
      const end = csr.offsets[u + 1]!;
      for (let e = begin; e < end; e++) {
        const w = csr.neighbors[e]!;
        if (member.has(w)) continue;
        const rhoW = rowOut[w] ?? 1;
        // Prefer attachments across open boundary.
        const openness = 1 - Math.min(rhoU, rhoW);
        if (openness <= 0 && rhoW >= 1 && rhoU >= 1) continue;
        const c = field.edgeConductance[e] ?? 0;
        const score = (openness + 1e-6) * c * (field.phi[w] ?? 0);
        candidates.push({ w, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const seenW = new Set<number>();
    let added = 0;
    for (const { w } of candidates) {
      if (added >= maxBoundaryAlts) break;
      if (seenW.has(w)) continue;
      seenW.add(w);
      const nodes = [...h.nodes, w].sort((a, b) => a - b);
      const key = componentKey(nodes);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      alts.push({
        id: nextId++,
        nodes,
        key,
        birth: h.birth,
        death: h.death,
        kind: 'boundary-alt',
        mass: componentMass(nodes, field.phi),
      });
      added++;
    }
  }

  hypotheses = [...hypotheses, ...alts];

  if (hypotheses.length > maxHypotheses) {
    hypotheses.sort((a, b) => persistenceScore(b) - persistenceScore(a));
    hypotheses = hypotheses.slice(0, maxHypotheses);
    // Reassign compact ids for downstream Hasse indexing.
    hypotheses.forEach((h, i) => {
      h.id = i;
    });
  }

  return { field, hypotheses, thresholds };
}

/** Nodes on the frontier of any maximal hypothesis. */
export function hypothesisBoundaryNodes(
  csr: CSRGraph,
  hypotheses: Hypothesis[],
): Set<number> {
  if (hypotheses.length === 0) return new Set();

  const containedInLarger = new Set<number>();
  for (let i = 0; i < hypotheses.length; i++) {
    for (let j = 0; j < hypotheses.length; j++) {
      if (i === j) continue;
      if (isStrictSubset(hypotheses[i]!.nodes, hypotheses[j]!.nodes)) {
        containedInLarger.add(hypotheses[i]!.id);
        break;
      }
    }
  }

  const boundary = new Set<number>();
  for (const h of hypotheses) {
    if (containedInLarger.has(h.id)) continue;
    const member = new Set(h.nodes);
    for (const u of h.nodes) {
      const begin = csr.offsets[u]!;
      const end = csr.offsets[u + 1]!;
      let onBoundary = false;
      for (let e = begin; e < end; e++) {
        if (!member.has(csr.neighbors[e]!)) {
          onBoundary = true;
          break;
        }
      }
      if (onBoundary) boundary.add(u);
    }
  }
  return boundary;
}

export function isStrictSubset(a: number[], b: number[]): boolean {
  if (a.length >= b.length) return false;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (a[i]! < b[j]!) {
      return false;
    } else {
      j++;
    }
  }
  return i === a.length;
}

export function isSubset(a: number[], b: number[]): boolean {
  if (a.length > b.length) return false;
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return isStrictSubset(a, b) || (a.length === 0 && b.length >= 0);
}
