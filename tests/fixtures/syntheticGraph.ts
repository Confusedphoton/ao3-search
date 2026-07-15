import {
  buildCSR,
  seedIndicesForAuthors,
  seedIndicesForTags,
  seedIndicesForWorks,
  type CSRGraph,
} from '@/src/graph/csr';
import { NodeKind, type AuthorWorkEdge, type GraphEdge, type GraphNode } from '@/src/graph/types';
import type { QueryPropagationInput } from '@/src/propagation/runQueryPropagation';
import type { RelevancePropagationInput } from '@/src/propagation';

export const DEFAULT_PROPAGATION_PARAMS = {
  alpha: 0.5,
  maxIterations: 200,
  tolerance: 1e-8,
} as const;

export interface SyntheticWorkInput {
  key: string;
  title?: string;
  wordCount?: number | null;
  explored?: boolean;
  estimatedFreq?: number;
  calibratedFreq?: number | null;
  /** Tag keys this work is connected to. */
  tags?: string[];
  /** Author keys this work is connected to. */
  authors?: string[];
}

export interface SyntheticTagInput {
  key: string;
  estimatedFreq?: number;
  calibratedFreq?: number | null;
  explored?: boolean;
}

export interface SyntheticAuthorInput {
  key: string;
  title?: string;
  estimatedFreq?: number;
  explored?: boolean;
}

export interface RawCsrInput {
  offsets: number[];
  neighbors: number[];
  edgeWeights?: number[];
  rowOutFractions?: number[] | Float64Array;
  nodeKinds?: NodeKind[];
  wordCounts?: Array<number | null>;
}

export interface SeedSelection {
  works?: string[];
  tags?: string[];
  authors?: string[];
}

export interface PropagationRunOptions extends Partial<typeof DEFAULT_PROPAGATION_PARAMS> {
  positive?: SeedSelection;
  negative?: SeedSelection;
  seedIndices?: number[];
  negativeSeedIndices?: number[];
  negativeLambda?: number;
  rowOutFractions?: number[] | Float64Array;
}

type NodeRef = { kind: NodeKind; key: string };

function nodeRefKey(kind: NodeKind, key: string): string {
  return `${kind}:${key}`;
}

function defaultGraphNode(id: number, kind: NodeKind, key: string, overrides: Partial<GraphNode> = {}): GraphNode {
  const explorationStatus =
    overrides.explorationStatus ?? (overrides.explored ? 'complete' : 'unexplored');
  return {
    id,
    kind,
    key,
    estimatedFreq: 1,
    calibratedFreq: null,
    wordCount: null,
    explorationStatus,
    exploredAt: explorationStatus === 'complete' ? 1 : null,
    listingNextPage: null,
    listingPagesFetched: explorationStatus === 'unexplored' ? 0 : 1,
    explored: explorationStatus === 'complete',
    ...overrides,
    explorationStatus:
      overrides.explorationStatus ?? (overrides.explored ? 'complete' : 'unexplored'),
    explored:
      (overrides.explorationStatus ?? (overrides.explored ? 'complete' : 'unexplored')) ===
      'complete',
  };
}

function l1Norm(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += Math.abs(values[i]);
  return sum;
}

function collectTagKeys(works: SyntheticWorkInput[], tags: SyntheticTagInput[]): Set<string> {
  const keys = new Set(tags.map((tag) => tag.key));
  for (const work of works) {
    for (const tagKey of work.tags ?? []) keys.add(tagKey);
  }
  return keys;
}

function collectAuthorKeys(works: SyntheticWorkInput[], authors: SyntheticAuthorInput[]): Set<string> {
  const keys = new Set(authors.map((author) => author.key));
  for (const work of works) {
    for (const authorKey of work.authors ?? []) keys.add(authorKey);
  }
  return keys;
}

function buildSnapshot(
  works: SyntheticWorkInput[],
  tags: SyntheticTagInput[],
  authors: SyntheticAuthorInput[],
): { snapshot: { nodes: GraphNode[]; edges: GraphEdge[]; authorEdges: AuthorWorkEdge[] }; indexByRef: Map<string, number> } {
  const tagByKey = new Map(tags.map((tag) => [tag.key, tag]));
  const authorByKey = new Map(authors.map((author) => [author.key, author]));

  for (const tagKey of collectTagKeys(works, tags)) {
    if (!tagByKey.has(tagKey)) tagByKey.set(tagKey, { key: tagKey });
  }
  for (const authorKey of collectAuthorKeys(works, authors)) {
    if (!authorByKey.has(authorKey)) authorByKey.set(authorKey, { key: authorKey });
  }

  const nodes: GraphNode[] = [];
  const indexByRef = new Map<string, number>();
  let nextId = 1;

  const register = (kind: NodeKind, key: string, overrides: Partial<GraphNode> = {}): number => {
    const ref = nodeRefKey(kind, key);
    const existing = indexByRef.get(ref);
    if (existing !== undefined) return existing;

    const id = nextId++;
    const index = nodes.length;
    nodes.push(defaultGraphNode(id, kind, key, overrides));
    indexByRef.set(ref, index);
    return index;
  };

  for (const work of works) {
    register(NodeKind.Work, work.key, {
      title: work.title,
      wordCount: work.wordCount ?? null,
      explorationStatus: work.explored ? 'complete' : 'unexplored',
      explored: work.explored ?? false,
      estimatedFreq: work.estimatedFreq ?? 1,
      calibratedFreq: work.calibratedFreq ?? null,
    });
  }
  for (const tag of tagByKey.values()) {
    register(NodeKind.Tag, tag.key, {
      explorationStatus: tag.explored ? 'complete' : 'unexplored',
      explored: tag.explored ?? false,
      estimatedFreq: tag.estimatedFreq ?? 1,
      calibratedFreq: tag.calibratedFreq ?? null,
    });
  }
  for (const author of authorByKey.values()) {
    register(NodeKind.Author, author.key, {
      title: author.title,
      explorationStatus: author.explored ? 'complete' : 'unexplored',
      explored: author.explored ?? false,
      estimatedFreq: author.estimatedFreq ?? 2,
    });
  }

  const nodeIdByRef = new Map<string, number>();
  for (const node of nodes) {
    nodeIdByRef.set(nodeRefKey(node.kind, node.key), node.id);
  }

  const edges: GraphEdge[] = [];
  const authorEdges: AuthorWorkEdge[] = [];

  for (const work of works) {
    const workNodeId = nodeIdByRef.get(nodeRefKey(NodeKind.Work, work.key));
    if (workNodeId === undefined) continue;

    for (const tagKey of work.tags ?? []) {
      const tagNodeId = nodeIdByRef.get(nodeRefKey(NodeKind.Tag, tagKey));
      if (tagNodeId !== undefined) edges.push({ workNodeId, tagNodeId });
    }
    for (const authorKey of work.authors ?? []) {
      const authorNodeId = nodeIdByRef.get(nodeRefKey(NodeKind.Author, authorKey));
      if (authorNodeId !== undefined) authorEdges.push({ workNodeId, authorNodeId });
    }
  }

  return { snapshot: { nodes, edges, authorEdges }, indexByRef };
}

function resolveSeedIndices(graph: SyntheticGraph, selection: SeedSelection | undefined): number[] {
  if (!selection) return [];
  if (!graph.csr) {
    throw new Error('Seed keys require a semantic synthetic graph built from works/tags/authors');
  }

  return [
    ...seedIndicesForWorks(graph.csr, selection.works ?? []),
    ...seedIndicesForTags(graph.csr, selection.tags ?? []),
    ...seedIndicesForAuthors(graph.csr, selection.authors ?? []),
  ];
}

export class SyntheticGraphBuilder {
  private works: SyntheticWorkInput[] = [];
  private tags: SyntheticTagInput[] = [];
  private authors: SyntheticAuthorInput[] = [];

  work(input: SyntheticWorkInput): this {
    this.works.push(input);
    return this;
  }

  tag(input: SyntheticTagInput): this {
    this.tags.push(input);
    return this;
  }

  author(input: SyntheticAuthorInput): this {
    this.authors.push(input);
    return this;
  }

  build(): SyntheticGraph {
    if (this.works.length + this.tags.length + this.authors.length === 0) {
      throw new Error('SyntheticGraphBuilder requires at least one node');
    }
    const { snapshot, indexByRef } = buildSnapshot(this.works, this.tags, this.authors);
    return SyntheticGraph.fromCsr(buildCSR(snapshot), indexByRef);
  }
}

export class SyntheticGraph {
  readonly csr: CSRGraph | null;
  private readonly raw: RawCsrInput | null;
  private readonly indexByRef: Map<string, number>;

  static fromCsr(csr: CSRGraph, indexByRef: Map<string, number> = new Map()): SyntheticGraph {
    return new SyntheticGraph(csr, indexByRef);
  }

  static fromRaw(input: RawCsrInput): SyntheticGraph {
    return new SyntheticGraph(null, new Map(), input);
  }

  private constructor(
    csr: CSRGraph | null,
    indexByRef: Map<string, number>,
    raw: RawCsrInput | null = null,
  ) {
    this.csr = csr;
    this.indexByRef = indexByRef;
    this.raw = raw;
    if (csr) {
      for (const [index, node] of csr.nodeByIndex.entries()) {
        this.indexByRef.set(nodeRefKey(node.kind, node.key), index);
      }
    }
  }

  get nodeCount(): number {
    return this.csr?.nodeCount ?? this.raw!.offsets.length - 1;
  }

  get offsets(): number[] {
    return this.csr?.offsets ?? this.raw!.offsets;
  }

  get neighbors(): number[] {
    return this.csr?.neighbors ?? this.raw!.neighbors;
  }

  get edgeWeights(): number[] {
    return this.csr?.edgeWeights ?? this.raw!.edgeWeights ?? this.raw!.neighbors.map(() => 1);
  }

  get rowOutFractions(): Float64Array {
    if (this.csr) return this.csr.rowOutFractions;
    const nodeCount = this.nodeCount;
    if (this.raw?.rowOutFractions) {
      return this.raw.rowOutFractions instanceof Float64Array
        ? this.raw.rowOutFractions
        : new Float64Array(this.raw.rowOutFractions);
    }
    return new Float64Array(nodeCount).fill(1);
  }

  get workIndices(): number[] {
    return this.csr?.workIndices ?? this.indicesForKind(NodeKind.Work);
  }

  get tagIndices(): number[] {
    return this.csr?.tagIndices ?? this.indicesForKind(NodeKind.Tag);
  }

  get authorIndices(): number[] {
    return this.csr?.authorIndices ?? this.indicesForKind(NodeKind.Author);
  }

  get authorWorkIndexEdges(): Array<{ workIndex: number; authorIndex: number }> {
    return this.csr?.authorWorkIndexEdges ?? [];
  }

  get nodeKinds(): NodeKind[] {
    if (this.csr) return this.csr.nodeByIndex.map((node) => node.kind);
    return this.raw?.nodeKinds ?? Array.from({ length: this.nodeCount }, () => NodeKind.Work);
  }

  get wordCounts(): Array<number | null> {
    if (this.csr) return this.csr.nodeByIndex.map((node) => node.wordCount ?? null);
    return this.raw?.wordCounts ?? Array.from({ length: this.nodeCount }, () => null);
  }

  index(kind: NodeKind, key: string): number {
    const index = this.indexByRef.get(nodeRefKey(kind, key));
    if (index === undefined) {
      throw new Error(`Unknown ${NodeKind[kind]} node key: ${key}`);
    }
    return index;
  }

  work(key: string): number {
    return this.index(NodeKind.Work, key);
  }

  tag(key: string): number {
    return this.index(NodeKind.Tag, key);
  }

  author(key: string): number {
    return this.index(NodeKind.Author, key);
  }

  indexOrUndefined(kind: NodeKind, key: string): number | undefined {
    return this.indexByRef.get(nodeRefKey(kind, key));
  }

  relevanceInput(options: PropagationRunOptions = {}): RelevancePropagationInput {
    const seedIndices = options.seedIndices ?? resolveSeedIndices(this, options.positive);
    const negativeSeedIndices = options.negativeSeedIndices ?? resolveSeedIndices(this, options.negative);

    return {
      offsets: this.offsets,
      neighbors: this.neighbors,
      edgeWeights: this.edgeWeights,
      rowOutFractions: options.rowOutFractions ?? this.rowOutFractions,
      seedIndices,
      negativeSeedIndices,
      negativeLambda: options.negativeLambda,
      alpha: options.alpha ?? DEFAULT_PROPAGATION_PARAMS.alpha,
      maxIterations: options.maxIterations ?? DEFAULT_PROPAGATION_PARAMS.maxIterations,
      tolerance: options.tolerance ?? DEFAULT_PROPAGATION_PARAMS.tolerance,
    };
  }

  queryInput(options: PropagationRunOptions = {}): QueryPropagationInput {
    const seedIndices = options.seedIndices ?? resolveSeedIndices(this, options.positive);
    const negativeSeedIndices = options.negativeSeedIndices ?? resolveSeedIndices(this, options.negative);

    return {
      offsets: this.offsets,
      neighbors: this.neighbors,
      edgeWeights: this.edgeWeights,
      rowOutFractions: options.rowOutFractions ?? this.rowOutFractions,
      seedIndices,
      negativeSeedIndices,
      negativeLambda: options.negativeLambda,
      workIndices: this.workIndices,
      tagIndices: this.tagIndices,
      authorIndices: this.authorIndices,
      authorWorkIndexEdges: this.authorWorkIndexEdges,
      wordCounts: this.wordCounts,
      nodeKinds: this.nodeKinds,
      alpha: options.alpha ?? DEFAULT_PROPAGATION_PARAMS.alpha,
      maxIterations: options.maxIterations ?? DEFAULT_PROPAGATION_PARAMS.maxIterations,
      tolerance: options.tolerance ?? DEFAULT_PROPAGATION_PARAMS.tolerance,
    };
  }

  l1Norm(values: ArrayLike<number>): number {
    return l1Norm(values);
  }

  rankedIndices(values: ArrayLike<number>, indices: number[]): number[] {
    return [...indices].sort((a, b) => values[b] - values[a]);
  }

  rankedWorkKeys(relevance: ArrayLike<number>): string[] {
    if (!this.csr) {
      throw new Error('rankedWorkKeys requires a semantic synthetic graph');
    }
    return this.rankedIndices(relevance, this.workIndices).map((index) => this.csr!.nodeByIndex[index].key);
  }

  private indicesForKind(kind: NodeKind): number[] {
    const kinds = this.raw?.nodeKinds;
    if (!kinds) return [];
    const indices: number[] = [];
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === kind) indices.push(i);
    }
    return indices;
  }
}

export function syntheticGraph(): SyntheticGraphBuilder {
  return new SyntheticGraphBuilder();
}

/** Undirected line 0 — 1 — … — (n - 1) in raw CSR form. */
export function lineGraph(nodeCount: number, edgeWeight = 1): SyntheticGraph {
  if (nodeCount < 2) throw new Error('lineGraph requires at least two nodes');

  const offsets: number[] = [0];
  const neighbors: number[] = [];
  const edgeWeights: number[] = [];

  for (let node = 0; node < nodeCount; node++) {
    if (node > 0) {
      neighbors.push(node - 1);
      edgeWeights.push(edgeWeight);
    }
    if (node < nodeCount - 1) {
      neighbors.push(node + 1);
      edgeWeights.push(edgeWeight);
    }
    offsets.push(neighbors.length);
  }

  return SyntheticGraph.fromRaw({ offsets, neighbors, edgeWeights });
}

/** Directed cycle 0 → 1 → … → (n - 1) → 0. */
export function cycleGraph(nodeCount: number, edgeWeight = 1): SyntheticGraph {
  if (nodeCount < 2) throw new Error('cycleGraph requires at least two nodes');

  const offsets: number[] = [0];
  const neighbors: number[] = [];
  const edgeWeights: number[] = [];

  for (let node = 0; node < nodeCount; node++) {
    neighbors.push((node + 1) % nodeCount);
    edgeWeights.push(edgeWeight);
    offsets.push(neighbors.length);
  }

  return SyntheticGraph.fromRaw({ offsets, neighbors, edgeWeights });
}

/** One central tag connected to evenly spaced works. */
export function tagStarGraph(workKeys: string[], tagKey = 'hub'): SyntheticGraph {
  const builder = syntheticGraph().tag({ key: tagKey });
  for (const key of workKeys) {
    builder.work({ key, tags: [tagKey] });
  }
  return builder.build();
}

/** Two works linked only through a shared author. */
export function authorBridgeGraph(
  seedWorkKey: string,
  otherWorkKey: string,
  authorKey = 'writer',
): SyntheticGraph {
  return syntheticGraph()
    .author({ key: authorKey })
    .work({ key: seedWorkKey, authors: [authorKey], explored: true })
    .work({ key: otherWorkKey, authors: [authorKey] })
    .build();
}

/** Two clusters that share no nodes or edges. */
export function disconnectedPairGraph(): SyntheticGraph {
  return syntheticGraph()
    .tag({ key: 'tag-a' })
    .tag({ key: 'tag-b' })
    .work({ key: '100', tags: ['tag-a'], explored: true })
    .work({ key: '200', tags: ['tag-b'] })
    .build();
}

/** Two works only reachable from each other through a bridge tag. */
export function tagBridgeGraph(
  leftWorkKey: string,
  rightWorkKey: string,
  bridgeTagKey = 'bridge',
): SyntheticGraph {
  return syntheticGraph()
    .tag({ key: bridgeTagKey })
    .work({ key: leftWorkKey, tags: [bridgeTagKey], explored: true })
    .work({ key: rightWorkKey, tags: [bridgeTagKey] })
    .build();
}

export function vectorL1Norm(values: ArrayLike<number>): number {
  return l1Norm(values);
}
