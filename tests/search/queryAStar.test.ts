import { describe, expect, it } from 'vitest';
import { buildCSR } from '@/src/graph/csr';
import { normalizeExplorationFields } from '@/src/graph/exploration';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';
import {
  createExpansionPolicy,
  DefaultExpansionPolicy,
} from '@/src/search/expansionPolicy';
import { TopologicalQueryExpansionPolicy } from '@/src/search/topology/TopologicalQueryExpansionPolicy';
import { runQueryAStar } from '@/src/search/topology/queryAStar';
import {
  bestNodeBindState,
  emptyQueryState,
  expandQueryStates,
  leafScore,
  queryStateKey,
  queryStateToSearchParams,
  toFetchPlan,
  type QuerySearchContext,
  type QueryState,
} from '@/src/search/topology/queryState';
import { runTopologyPipeline } from '@/src/search/topology/topologyPipeline';
import { QUERY_ASTAR_BRANCH_K } from '@/src/config/constants';

function openRowOut(csr: ReturnType<typeof buildCSR>): Float64Array {
  const rowOut = new Float64Array(csr.nodeCount).fill(1);
  for (let i = 0; i < csr.nodeCount; i++) {
    const node = csr.nodeByIndex[i]!;
    if (node.explorationStatus !== 'complete') rowOut[i] = 0.25;
  }
  return rowOut;
}

function searchSnapshot(): GraphSnapshot {
  // seed work — popular tag (complete) — work2 — rare tag (unexplored)
  return {
    nodes: [
      normalizeExplorationFields({
        id: 1,
        kind: NodeKind.Work,
        key: '10',
        wordCount: 3000,
        estimatedFreq: 1,
        explorationStatus: 'complete',
        explored: true,
      }),
      normalizeExplorationFields({
        id: 2,
        kind: NodeKind.Tag,
        key: 'Popular',
        estimatedFreq: 100,
        explorationStatus: 'complete',
        exploredAt: Date.now(),
        listingNextPage: null,
        explored: true,
      }),
      normalizeExplorationFields({
        id: 3,
        kind: NodeKind.Work,
        key: '20',
        wordCount: 2000,
        estimatedFreq: 1,
        explorationStatus: 'unexplored',
        explored: false,
      }),
      normalizeExplorationFields({
        id: 4,
        kind: NodeKind.Tag,
        key: 'Rare',
        estimatedFreq: 2,
        explorationStatus: 'unexplored',
        explored: false,
      }),
    ],
    edges: [
      { workNodeId: 1, tagNodeId: 2 },
      { workNodeId: 3, tagNodeId: 2 },
      { workNodeId: 3, tagNodeId: 4 },
    ],
    authorEdges: [],
  };
}

function queryCtxFromSnapshot(snapshot: GraphSnapshot): QuerySearchContext {
  const csr = buildCSR(snapshot);
  const relevance = new Float64Array(csr.nodeCount).fill(0.4);
  const authority = new Float64Array(csr.nodeCount).fill(0.5);
  const precision = new Float64Array(csr.nodeCount).fill(1);
  // Boost the complete popular tag so include-based search can beat node bind.
  const popularIdx = csr.indexByNodeId.get(2)!;
  relevance[popularIdx] = 5;
  authority[popularIdx] = 5;
  const pipeline = runTopologyPipeline({
    csr,
    relevance,
    authority,
    precision,
    rowOutFractions: openRowOut(csr),
  });
  // Force popular tag fragility above expandable nodes for worksSearch incumbent tests.
  let maxFrag = 0;
  for (let i = 0; i < pipeline.fragility.length; i++) {
    maxFrag = Math.max(maxFrag, pipeline.fragility[i] ?? 0);
  }
  pipeline.fragility[popularIdx] = maxFrag + 10;
  return {
    csr,
    relevance,
    fragility: pipeline.fragility,
    hypotheses: pipeline.hypotheses,
    now: Date.now(),
  };
}

describe('queryState', () => {
  it('hashes states by normalized include/exclude/expand/page', () => {
    const a: QueryState = {
      include: [1, 3],
      exclude: [2],
      expandIndex: null,
      page: 1,
      depth: 2,
      g: 2,
      h: 1,
    };
    const b: QueryState = { ...a, depth: 9, g: 9, h: 0 };
    expect(queryStateKey(a)).toBe(queryStateKey(b));
    expect(queryStateKey({ ...a, page: 2 })).not.toBe(queryStateKey(a));
  });

  it('maps includes to typed AO3 fields when tag types are known', () => {
    const csr = buildCSR(searchSnapshot());
    const fandomIdx = csr.indexByNodeId.get(2)!;
    const freeformIdx = csr.indexByNodeId.get(4)!;
    const state: QueryState = {
      include: [fandomIdx, freeformIdx].sort((a, b) => a - b),
      exclude: [],
      expandIndex: null,
      page: 1,
      depth: 1,
      g: 1,
      h: 1,
    };
    const params = queryStateToSearchParams(
      state,
      csr,
      new Map([
        ['Popular', 'Fandom'],
        ['Rare', 'Freeform'],
      ]),
    );
    expect(params.fandomNames).toEqual(['Popular']);
    expect(params.freeformNames).toEqual(['Rare']);
    expect(toFetchPlan(state, csr, new Map([['Popular', 'Fandom']]))).toEqual({
      type: 'worksSearch',
      params: expect.objectContaining({ fandomNames: ['Popular'] }),
    });
  });

  it('toFetchPlan prefers bound node expand over worksSearch', () => {
    const csr = buildCSR(searchSnapshot());
    const tagIdx = csr.indexByNodeId.get(4)!;
    const state: QueryState = {
      include: [tagIdx],
      exclude: [],
      expandIndex: tagIdx,
      page: 1,
      depth: 0,
      g: 0,
      h: 1,
    };
    expect(toFetchPlan(state, csr)).toEqual({
      type: 'tagListing',
      tagName: 'Rare',
      page: 1,
      marksNodeId: 4,
    });
  });

  it('caps operator branching by QUERY_ASTAR_BRANCH_K', () => {
    const ctx = queryCtxFromSnapshot(searchSnapshot());
    const children = expandQueryStates(emptyQueryState(), {
      ...ctx,
      branchK: 2,
    });
    const binds = children.filter((c) => c.expandIndex != null);
    expect(binds.length).toBeLessThanOrEqual(2);
    expect(children.length).toBeLessThanOrEqual(QUERY_ASTAR_BRANCH_K * 3);
  });
});

describe('runQueryAStar', () => {
  it('always returns a depth-0 node action when expandable nodes exist', () => {
    const ctx = queryCtxFromSnapshot(searchSnapshot());
    // Neutralize the forced popular boost so node bind wins.
    const popularIdx = ctx.csr.indexByNodeId.get(2)!;
    ctx.fragility[popularIdx] = 0;
    const depth0 = bestNodeBindState(ctx);
    expect(depth0).not.toBeNull();

    const result = runQueryAStar(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.meta?.kind).toBe('node');
    expect(result.action!.plan.type).not.toBe('worksSearch');
  });

  it('can replace the incumbent with a higher-scoring worksSearch', () => {
    const ctx = queryCtxFromSnapshot(searchSnapshot());
    const result = runQueryAStar(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.meta?.kind).toBe('worksSearch');
    expect(result.action!.plan.type).toBe('worksSearch');
    if (result.action!.plan.type === 'worksSearch') {
      const names = [
        ...(result.action!.plan.params.fandomNames ?? []),
        ...(result.action!.plan.params.freeformNames ?? []),
        ...(result.action!.plan.params.characterNames ?? []),
        ...(result.action!.plan.params.relationshipNames ?? []),
      ];
      expect(names).toContain('Popular');
    }
    expect(result.action!.meta?.depth).toBeGreaterThan(0);
  });

  it('stops expanding when the think budget elapses', () => {
    const ctx = queryCtxFromSnapshot(searchSnapshot());
    ctx.maxThinkMs = 0;
    const result = runQueryAStar(ctx);
    expect(result.timedOut).toBe(true);
    expect(result.nodesExpanded).toBe(0);
    // Depth-0 incumbent is still available before the timed deeper search.
    expect(result.action).not.toBeNull();
    expect(result.action!.meta?.kind).toBe('node');
  });

  it('leafScore uses bound-node fragility or mean of includes', () => {
    const fragility = new Float64Array([0, 4, 6]);
    expect(
      leafScore(
        {
          include: [],
          exclude: [],
          expandIndex: 1,
          page: 1,
          depth: 0,
          g: 0,
          h: 0,
        },
        fragility,
      ),
    ).toBe(4);
    expect(
      leafScore(
        {
          include: [1, 2],
          exclude: [],
          expandIndex: null,
          page: 1,
          depth: 1,
          g: 1,
          h: 0,
        },
        fragility,
      ),
    ).toBe(5);
  });
});

describe('TopologicalQueryExpansionPolicy', () => {
  it('is registered as topo-query and proposes an action', () => {
    const policy = createExpansionPolicy('topo-query');
    expect(policy).toBeInstanceOf(TopologicalQueryExpansionPolicy);
    expect(policy.minAcquisitionScore).toBeGreaterThan(0);

    const csr = buildCSR(searchSnapshot());
    const relevance = new Float64Array(csr.nodeCount).fill(0.5);
    const authority = new Float64Array(csr.nodeCount).fill(0.5);
    const precision = new Float64Array(csr.nodeCount).fill(1);
    const action = policy.propose({
      csr,
      relevance,
      authority,
      precision,
      rowOutFractions: openRowOut(csr),
    });
    expect(action).not.toBeNull();
    expect(action!.plan).toBeTruthy();
    expect(policy.topologySnapshot()).not.toBeNull();
  });
});

describe('DefaultExpansionPolicy.propose', () => {
  it('matches selectNextPlan for a partial tag hub', () => {
    const csr = buildCSR({
      nodes: [
        normalizeExplorationFields({
          id: 1,
          kind: NodeKind.Tag,
          key: 'fluff',
          estimatedFreq: 1,
          explorationStatus: 'partial',
          listingNextPage: 2,
          listingPagesFetched: 1,
          explored: false,
        }),
      ],
      edges: [],
      authorEdges: [],
    });
    const policy = new DefaultExpansionPolicy();
    const ctx = {
      csr,
      relevance: new Float64Array([1]),
      authority: new Float64Array([1]),
      precision: new Float64Array([1]),
    };
    expect(policy.propose(ctx)).toEqual({
      plan: {
        type: 'tagListing',
        tagName: 'fluff',
        page: 2,
        marksNodeId: 1,
      },
      score: expect.any(Number),
      meta: { depth: 0, kind: 'node' },
    });
  });
});
