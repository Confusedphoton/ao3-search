import {
  QUERY_ASTAR_DEPTH_LAMBDA,
  QUERY_ASTAR_MAX_DEPTH,
  QUERY_ASTAR_MAX_NODES,
} from '../../config/constants';
import type { ExpansionAction } from '../expansionPolicy';
import {
  bestNodeBindState,
  emptyQueryState,
  expandQueryStates,
  isExecutableLeaf,
  leafScore,
  queryPriority,
  queryStateKey,
  toFetchPlan,
  type QuerySearchContext,
  type QueryState,
} from './queryState';

export interface QueryAStarResult {
  action: ExpansionAction | null;
  depthReached: number;
  nodesExpanded: number;
  /** True when the wall-clock think budget stopped further expansion. */
  timedOut: boolean;
}

/**
 * Anytime iterative-deepening best-first search over QueryStates.
 * Depth 0 always seeds the incumbent with the best expandable node (when any).
 * Deeper bounds may replace the incumbent with a higher-scoring leaf
 * (node expand/requery or worksSearch).
 *
 * When `ctx.maxThinkMs` is set, expansion stops once the budget elapses so a
 * longer allotment than the AO3 request delay can keep improving the incumbent
 * past the moment a fetch would otherwise be allowed.
 */
export function runQueryAStar(ctx: QuerySearchContext): QueryAStarResult {
  const depthLambda = ctx.depthLambda ?? QUERY_ASTAR_DEPTH_LAMBDA;
  const maxDepth = QUERY_ASTAR_MAX_DEPTH;
  const maxNodes = QUERY_ASTAR_MAX_NODES;
  const deadline =
    ctx.maxThinkMs != null && Number.isFinite(ctx.maxThinkMs)
      ? Date.now() + Math.max(0, ctx.maxThinkMs)
      : Number.POSITIVE_INFINITY;

  const depth0 = bestNodeBindState(ctx);
  let incumbent: QueryState | null = depth0;
  let incumbentScore = depth0 ? leafScore(depth0, ctx.fragility) : -Infinity;
  let depthReached = 0;
  let nodesExpanded = 0;
  let timedOut = false;

  if (!depth0 && !isExecutableLeaf(emptyQueryState())) {
    // Still allow pure search construction from empty root at depth ≥ 1
  }

  for (let depthBound = 1; depthBound <= maxDepth; depthBound++) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }

    const open: QueryState[] = [emptyQueryState()];
    const closed = new Set<string>();
    let improved = false;
    let layerExpanded = 0;

    while (open.length > 0 && nodesExpanded < maxNodes) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }

      open.sort((a, b) => queryPriority(b, depthLambda) - queryPriority(a, depthLambda));
      const current = open.shift()!;
      const key = queryStateKey(current);
      if (closed.has(key)) continue;
      closed.add(key);
      nodesExpanded += 1;
      layerExpanded += 1;

      if (isExecutableLeaf(current)) {
        const score = leafScore(current, ctx.fragility);
        if (score > incumbentScore) {
          incumbent = current;
          incumbentScore = score;
          improved = true;
        }
      }

      if (current.depth >= depthBound) continue;

      for (const child of expandQueryStates(current, ctx)) {
        if (child.depth > depthBound) continue;
        const childKey = queryStateKey(child);
        if (closed.has(childKey)) continue;
        open.push(child);
      }
    }

    depthReached = depthBound;
    if (timedOut) break;
    if (layerExpanded === 0) break;
    // Diminishing returns: no improvement and OPEN exhausted under budget
    if (!improved && nodesExpanded >= maxNodes) break;
  }

  if (!incumbent) return { action: null, depthReached, nodesExpanded, timedOut };

  const plan = toFetchPlan(incumbent, ctx.csr, ctx.tagTypes);
  if (!plan) return { action: null, depthReached, nodesExpanded, timedOut };

  const kind = plan.type === 'worksSearch' ? 'worksSearch' : 'node';
  return {
    action: {
      plan,
      score: incumbentScore,
      meta: { depth: incumbent.depth, kind },
    },
    depthReached,
    nodesExpanded,
    timedOut,
  };
}
