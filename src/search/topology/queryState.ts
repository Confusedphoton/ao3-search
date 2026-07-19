import type { Ao3WorkSearchParams } from '../../ao3/workSearch';
import { QUERY_ASTAR_BRANCH_K } from '../../config/constants';
import type { CSRGraph } from '../../graph/csr';
import { isExpandable } from '../../graph/exploration';
import { NodeKind } from '../../graph/types';
import type { FetchPlan } from '../../scheduler/types';
import { planForNode } from '../expansionPolicy';
import { hypothesisBoundaryNodes, type Hypothesis } from './neighborhoods';
import type { TopologyPipelineResult } from './topologyPipeline';

export interface QueryState {
  /** Included tag CSR indices (sorted). */
  include: number[];
  /** Excluded tag CSR indices (sorted). */
  exclude: number[];
  /** Bound expandable node, or null for pure worksSearch. */
  expandIndex: number | null;
  page: number;
  depth: number;
  g: number;
  h: number;
}

export interface QuerySearchContext {
  csr: CSRGraph;
  relevance: Float64Array;
  fragility: Float64Array;
  hypotheses: Hypothesis[];
  now: number;
  tagTypes?: ReadonlyMap<string, string>;
  branchK?: number;
  depthLambda?: number;
}

export function emptyQueryState(): QueryState {
  return {
    include: [],
    exclude: [],
    expandIndex: null,
    page: 1,
    depth: 0,
    g: 0,
    h: 0,
  };
}

export function queryStateKey(state: QueryState): string {
  return [
    state.include.join(','),
    state.exclude.join(','),
    state.expandIndex ?? '',
    state.page,
  ].join('|');
}

function sortedUniqueInsert(sorted: number[], value: number): number[] | null {
  if (sorted.includes(value)) return null;
  const next = sorted.slice();
  let i = 0;
  while (i < next.length && next[i]! < value) i++;
  next.splice(i, 0, value);
  return next;
}

function topKByScore(
  indices: number[],
  scoreOf: (index: number) => number,
  k: number,
): number[] {
  if (indices.length <= k) {
    return [...indices].sort((a, b) => scoreOf(b) - scoreOf(a));
  }
  const scored = indices.map((index) => ({ index, score: scoreOf(index) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.index);
}

/** Best-first priority: higher is better. */
export function queryPriority(state: QueryState, depthLambda: number): number {
  return state.h - depthLambda * state.depth;
}

/**
 * Leaf / node proxy score from fragility.
 * Bound node → its fragility; pure search → mean fragility of includes
 * (or 0 if empty).
 */
export function leafScore(state: QueryState, fragility: Float64Array): number {
  if (state.expandIndex != null) {
    return fragility[state.expandIndex] ?? 0;
  }
  if (state.include.length === 0) return 0;
  let sum = 0;
  for (const idx of state.include) sum += fragility[idx] ?? 0;
  return sum / state.include.length;
}

export function isExecutableLeaf(state: QueryState): boolean {
  return state.expandIndex != null || state.include.length > 0;
}

export function expandQueryStates(
  parent: QueryState,
  ctx: QuerySearchContext,
): QueryState[] {
  const branchK = ctx.branchK ?? QUERY_ASTAR_BRANCH_K;
  const children: QueryState[] = [];
  const includeSet = new Set(parent.include);
  const excludeSet = new Set(parent.exclude);

  const pushChild = (partial: Omit<QueryState, 'g' | 'h'> & { h: number }) => {
    const child: QueryState = {
      ...partial,
      g: partial.depth,
      h: partial.h,
    };
    children.push(child);
  };

  // 1. Bind high-fragility expandable node
  if (parent.expandIndex == null) {
    const expandable: number[] = [];
    for (let i = 0; i < ctx.csr.nodeCount; i++) {
      const node = ctx.csr.nodeByIndex[i];
      if (!node || !isExpandable(node, ctx.now)) continue;
      expandable.push(i);
    }
    for (const index of topKByScore(expandable, (i) => ctx.fragility[i] ?? 0, branchK)) {
      pushChild({
        include: parent.include,
        exclude: parent.exclude,
        expandIndex: index,
        page: parent.page,
        depth: parent.depth + 1,
        h: ctx.fragility[index] ?? 0,
      });
    }
  }

  // 2. Include boundary / high-fragility tags
  const boundary = hypothesisBoundaryNodes(ctx.csr, ctx.hypotheses);
  const tagCandidates: number[] = [];
  for (const idx of boundary) {
    if (includeSet.has(idx) || excludeSet.has(idx)) continue;
    if (ctx.csr.nodeByIndex[idx]?.kind !== NodeKind.Tag) continue;
    tagCandidates.push(idx);
  }
  for (let i = 0; i < ctx.csr.nodeCount; i++) {
    if (includeSet.has(i) || excludeSet.has(i) || boundary.has(i)) continue;
    if (ctx.csr.nodeByIndex[i]?.kind !== NodeKind.Tag) continue;
    if ((ctx.fragility[i] ?? 0) <= 0) continue;
    tagCandidates.push(i);
  }
  for (const tagIndex of topKByScore(
    tagCandidates,
    (i) => ctx.fragility[i] ?? 0,
    branchK,
  )) {
    const include = sortedUniqueInsert(parent.include, tagIndex);
    if (!include) continue;
    const probe: QueryState = {
      include,
      exclude: parent.exclude,
      // Include builds toward worksSearch; drop any node bind.
      expandIndex: null,
      page: 1,
      depth: parent.depth + 1,
      g: 0,
      h: 0,
    };
    pushChild({
      ...probe,
      h: leafScore(probe, ctx.fragility),
    });
  }

  // 3. Exclude bridge / hub tags (low relevance, high degree among tags)
  const excludeCandidates: number[] = [];
  for (let i = 0; i < ctx.csr.nodeCount; i++) {
    if (includeSet.has(i) || excludeSet.has(i)) continue;
    if (ctx.csr.nodeByIndex[i]?.kind !== NodeKind.Tag) continue;
    const begin = ctx.csr.offsets[i]!;
    const end = ctx.csr.offsets[i + 1]!;
    const degree = end - begin;
    if (degree < 2) continue;
    excludeCandidates.push(i);
  }
  const hubScore = (i: number) => {
    const begin = ctx.csr.offsets[i]!;
    const end = ctx.csr.offsets[i + 1]!;
    const degree = end - begin;
    const rel = ctx.relevance[i] ?? 0;
    return degree / (1 + rel);
  };
  for (const tagIndex of topKByScore(excludeCandidates, hubScore, branchK)) {
    // Excludes only refine an existing include-set search (not node binds).
    if (parent.include.length === 0) continue;
    const exclude = sortedUniqueInsert(parent.exclude, tagIndex);
    if (!exclude) continue;
    const probe: QueryState = {
      include: parent.include,
      exclude,
      expandIndex: null,
      page: 1,
      depth: parent.depth + 1,
      g: 0,
      h: 0,
    };
    pushChild({
      ...probe,
      h: leafScore(probe, ctx.fragility),
    });
  }

  // 4. Paginate / requery bound hub
  if (parent.expandIndex != null) {
    const node = ctx.csr.nodeByIndex[parent.expandIndex];
    if (node && (node.kind === NodeKind.Tag || node.kind === NodeKind.Author)) {
      const nextPage =
        node.explorationStatus === 'complete' ? 1 : (node.listingNextPage ?? 1);
      if (nextPage !== parent.page || node.explorationStatus === 'complete') {
        pushChild({
          include: parent.include,
          exclude: parent.exclude,
          expandIndex: parent.expandIndex,
          page: nextPage === parent.page ? parent.page + 1 : nextPage,
          depth: parent.depth + 1,
          h: ctx.fragility[parent.expandIndex] ?? 0,
        });
      }
    }
  }

  // Annotate leaf scores for OPEN ordering
  for (const child of children) {
    child.h = leafScore(child, ctx.fragility);
  }
  return children;
}

function mapTagTypeToField(
  tagType: string | undefined,
): 'fandomNames' | 'characterNames' | 'relationshipNames' | 'freeformNames' {
  switch (tagType) {
    case 'Fandom':
      return 'fandomNames';
    case 'Character':
      return 'characterNames';
    case 'Relationship':
      return 'relationshipNames';
    default:
      return 'freeformNames';
  }
}

export function queryStateToSearchParams(
  state: QueryState,
  csr: CSRGraph,
  tagTypes?: ReadonlyMap<string, string>,
): Ao3WorkSearchParams {
  const params: Ao3WorkSearchParams = {
    page: state.page > 1 ? state.page : undefined,
  };
  const buckets: Record<
    'fandomNames' | 'characterNames' | 'relationshipNames' | 'freeformNames',
    string[]
  > = {
    fandomNames: [],
    characterNames: [],
    relationshipNames: [],
    freeformNames: [],
  };

  for (const idx of state.include) {
    const node = csr.nodeByIndex[idx];
    if (!node || node.kind !== NodeKind.Tag) continue;
    const field = mapTagTypeToField(tagTypes?.get(node.key));
    buckets[field].push(node.key);
  }
  if (buckets.fandomNames.length) params.fandomNames = buckets.fandomNames;
  if (buckets.characterNames.length) params.characterNames = buckets.characterNames;
  if (buckets.relationshipNames.length) {
    params.relationshipNames = buckets.relationshipNames;
  }
  if (buckets.freeformNames.length) params.freeformNames = buckets.freeformNames;

  if (state.exclude.length) {
    params.excludedTagNames = state.exclude
      .map((idx) => csr.nodeByIndex[idx])
      .filter((n): n is NonNullable<typeof n> => n != null && n.kind === NodeKind.Tag)
      .map((n) => n.key);
  }
  return params;
}

export function toFetchPlan(
  state: QueryState,
  csr: CSRGraph,
  tagTypes?: ReadonlyMap<string, string>,
): FetchPlan | null {
  if (state.expandIndex != null) {
    const plan = planForNode(csr, state.expandIndex);
    if (!plan) return null;
    if (plan.type === 'tagListing' || plan.type === 'authorListing') {
      return { ...plan, page: state.page };
    }
    return plan;
  }
  if (state.include.length === 0) return null;
  return {
    type: 'worksSearch',
    params: queryStateToSearchParams(state, csr, tagTypes),
  };
}

/** Depth-0 incumbent: best expandable node by fragility. */
export function bestNodeBindState(
  ctx: QuerySearchContext,
): QueryState | null {
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < ctx.csr.nodeCount; i++) {
    const node = ctx.csr.nodeByIndex[i];
    if (!node || !isExpandable(node, ctx.now)) continue;
    const score = ctx.fragility[i] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  return {
    include: [],
    exclude: [],
    expandIndex: bestIndex,
    page:
      ctx.csr.nodeByIndex[bestIndex]!.explorationStatus === 'complete'
        ? 1
        : (ctx.csr.nodeByIndex[bestIndex]!.listingNextPage ?? 1),
    depth: 0,
    g: 0,
    h: bestScore,
  };
}

export function pipelineToQueryContext(
  csr: CSRGraph,
  relevance: Float64Array,
  pipeline: TopologyPipelineResult,
  now: number,
  tagTypes?: ReadonlyMap<string, string>,
): QuerySearchContext {
  return {
    csr,
    relevance,
    fragility: pipeline.fragility,
    hypotheses: pipeline.hypotheses,
    now,
    tagTypes,
  };
}
