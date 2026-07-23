import type { CSRGraph } from '@/src/graph/csr';
import { buildCSR } from '@/src/graph/csr';
import { NodeKind, type AuthorWorkEdge, type GraphEdge, type GraphNode } from '@/src/graph/types';
import { SyntheticGraph } from '../../tests/fixtures/syntheticGraph';

/** Default multiplicative log-normal σ for measurement error. */
export const DEFAULT_MEASUREMENT_NOISE_SIGMA = 0.35;

export const EVAL_PERTURB_ENV = 'EVAL_PERTURB';

export interface MeasurementNoiseOptions {
  /** Log-normal σ applied to freqs, word counts, and edge weights. */
  sigma?: number;
  /** RNG seed; independent of corpus layout seed when set. */
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard normal. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Multiplicative log-normal factor exp(σ·Z). */
export function logNormalFactor(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 1;
  return Math.exp(sigma * gaussian(rng));
}

function perturbPositive(value: number, rng: () => number, sigma: number): number {
  const next = value * logNormalFactor(rng, sigma);
  return Number.isFinite(next) && next > 0 ? next : value;
}

function authorNeighborSet(csr: CSRGraph): Set<string> {
  const pairs = new Set<string>();
  for (const edge of csr.authorWorkIndexEdges) {
    pairs.add(`${edge.workIndex}:${edge.authorIndex}`);
  }
  return pairs;
}

function snapshotFromCsr(csr: CSRGraph): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  authorEdges: AuthorWorkEdge[];
} {
  const nodes = csr.nodeByIndex.map((node) => ({ ...node }));
  const edges: GraphEdge[] = [];
  const authorEdges: AuthorWorkEdge[] = [];
  const authorPairs = authorNeighborSet(csr);

  for (const workIndex of csr.workIndices) {
    const workId = csr.nodeByIndex[workIndex]!.id;
    const begin = csr.offsets[workIndex]!;
    const end = csr.offsets[workIndex + 1]!;
    for (let edge = begin; edge < end; edge++) {
      const neighbor = csr.neighbors[edge]!;
      const neighborNode = csr.nodeByIndex[neighbor]!;
      if (neighborNode.kind === NodeKind.Tag) {
        edges.push({ workNodeId: workId, tagNodeId: neighborNode.id });
      } else if (
        neighborNode.kind === NodeKind.Author &&
        authorPairs.has(`${workIndex}:${neighbor}`)
      ) {
        authorEdges.push({ workNodeId: workId, authorNodeId: neighborNode.id });
      }
    }
  }

  return { nodes, edges, authorEdges };
}

function mutateWeightsAndOrder(csr: CSRGraph, rng: () => number, sigma: number): void {
  for (let node = 0; node < csr.nodeCount; node++) {
    const begin = csr.offsets[node]!;
    const end = csr.offsets[node + 1]!;
    const degree = end - begin;
    if (degree === 0) continue;

    const neighbors: number[] = [];
    const weights: number[] = [];
    for (let edge = begin; edge < end; edge++) {
      neighbors.push(csr.neighbors[edge]!);
      weights.push(perturbPositive(csr.edgeWeights[edge]!, rng, sigma));
    }

    for (let i = degree - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmpN = neighbors[i]!;
      neighbors[i] = neighbors[j]!;
      neighbors[j] = tmpN;
      const tmpW = weights[i]!;
      weights[i] = weights[j]!;
      weights[j] = tmpW;
    }

    for (let i = 0; i < degree; i++) {
      csr.neighbors[begin + i] = neighbors[i]!;
      csr.edgeWeights[begin + i] = weights[i]!;
    }
  }
}

/**
 * Clone a closed latent graph into an observed graph with measurement noise on
 * hub frequencies, word counts, edge weights, and neighbor order.
 * Topology (endpoint pairs) is unchanged.
 */
export function createObservedGraph(
  latent: SyntheticGraph,
  options: MeasurementNoiseOptions = {},
): SyntheticGraph {
  const csr = latent.csr;
  if (!csr) {
    throw new Error('createObservedGraph requires a semantic synthetic graph');
  }

  const sigma = options.sigma ?? DEFAULT_MEASUREMENT_NOISE_SIGMA;
  const rng = mulberry32(options.seed ?? 0);
  const snapshot = snapshotFromCsr(csr);

  for (const node of snapshot.nodes) {
    node.estimatedFreq = perturbPositive(node.estimatedFreq, rng, sigma);
    if (node.calibratedFreq != null) {
      node.calibratedFreq = perturbPositive(node.calibratedFreq, rng, sigma);
    }
    if (node.wordCount != null) {
      node.wordCount = Math.max(1, Math.round(perturbPositive(node.wordCount, rng, sigma)));
    }
  }

  const observed = SyntheticGraph.fromCsr(buildCSR(snapshot));
  mutateWeightsAndOrder(observed.csr!, rng, sigma);
  return observed;
}

/**
 * Resolve whether measurement perturbation is enabled.
 * Default on; disable with `EVAL_PERTURB=0|false|off|no` or `--no-perturb`.
 */
export function resolveMeasurementPerturb(
  env: NodeJS.ProcessEnv = process.env,
  fallback = true,
): boolean {
  const raw = env[EVAL_PERTURB_ENV]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  throw new Error(
    `Invalid ${EVAL_PERTURB_ENV}="${env[EVAL_PERTURB_ENV]}". Expected 0/1, true/false, on/off, yes/no`,
  );
}

/** Peel `--no-perturb` / `--perturb` from argv; returns remaining args. */
export function takePerturbArg(argv: string[]): {
  perturb: boolean | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let perturb: boolean | undefined;

  for (const arg of argv) {
    if (arg === '--no-perturb') {
      perturb = false;
      continue;
    }
    if (arg === '--perturb') {
      perturb = true;
      continue;
    }
    rest.push(arg);
  }

  return { perturb, rest };
}

/**
 * After `buildCSR` rebuild, copy parent edge weights and relative neighbor
 * order so measurement noise survives fog rematerialization.
 */
export function restoreParentWeightsAndOrder(parent: CSRGraph, child: CSRGraph): void {
  const parentIndexByKey = new Map<string, number>();
  for (let i = 0; i < parent.nodeCount; i++) {
    const node = parent.nodeByIndex[i]!;
    parentIndexByKey.set(`${node.kind}:${node.key}`, i);
  }

  const childIndexByKey = new Map<string, number>();
  for (let i = 0; i < child.nodeCount; i++) {
    const node = child.nodeByIndex[i]!;
    childIndexByKey.set(`${node.kind}:${node.key}`, i);
  }

  for (let childNode = 0; childNode < child.nodeCount; childNode++) {
    const childMeta = child.nodeByIndex[childNode]!;
    const parentNode = parentIndexByKey.get(`${childMeta.kind}:${childMeta.key}`);
    if (parentNode === undefined) continue;

    const parentBegin = parent.offsets[parentNode]!;
    const parentEnd = parent.offsets[parentNode + 1]!;
    const parentOrder: Array<{ childNeighbor: number; weight: number }> = [];

    for (let edge = parentBegin; edge < parentEnd; edge++) {
      const parentNeighbor = parent.neighbors[edge]!;
      const parentNeighborNode = parent.nodeByIndex[parentNeighbor]!;
      const childNeighbor = childIndexByKey.get(
        `${parentNeighborNode.kind}:${parentNeighborNode.key}`,
      );
      if (childNeighbor === undefined) continue;
      parentOrder.push({
        childNeighbor,
        weight: parent.edgeWeights[edge]!,
      });
    }

    const childBegin = child.offsets[childNode]!;
    const childEnd = child.offsets[childNode + 1]!;
    const childDegree = childEnd - childBegin;
    if (childDegree === 0) continue;

    const present = new Set<number>();
    for (let edge = childBegin; edge < childEnd; edge++) {
      present.add(child.neighbors[edge]!);
    }

    const ordered = parentOrder.filter((entry) => present.has(entry.childNeighbor));
    const orderedSet = new Set(ordered.map((entry) => entry.childNeighbor));
    for (let edge = childBegin; edge < childEnd; edge++) {
      const neighbor = child.neighbors[edge]!;
      if (!orderedSet.has(neighbor)) {
        ordered.push({ childNeighbor: neighbor, weight: child.edgeWeights[edge]! });
      }
    }

    if (ordered.length !== childDegree) {
      // Topology mismatch — leave the rebuilt row alone.
      continue;
    }

    for (let i = 0; i < childDegree; i++) {
      child.neighbors[childBegin + i] = ordered[i]!.childNeighbor;
      child.edgeWeights[childBegin + i] = ordered[i]!.weight;
    }
  }
}
