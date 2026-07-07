import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildCSR } from '@/src/graph/csr';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';
import {
  buildNodeTable,
  SearchTraceRecorder,
  snapshotFrontier,
  snapshotPropagation,
  searchTraceInfo,
} from '@/src/debug/searchTrace';
import type { FrontierNode } from '@/src/search/frontier';
import { runQueryPropagation } from '@/src/propagation/runQueryPropagation';

const { expandNode, ensurePositiveSeeds, loadGraphSnapshot, runQueryPropagationViaWorker } = vi.hoisted(
  () => ({
    expandNode: vi.fn(),
    ensurePositiveSeeds: vi.fn(),
    loadGraphSnapshot: vi.fn(),
    runQueryPropagationViaWorker: vi.fn(),
  }),
);

vi.mock('@/src/storage/db', () => ({
  loadGraphSnapshot,
}));

vi.mock('@/src/compute/host', () => ({
  runQueryPropagationViaWorker,
  closeComputeHost: vi.fn(),
}));

vi.mock('@/src/scheduler/scheduler', () => ({
  RequestScheduler: class MockRequestScheduler {
    ensurePositiveSeeds = ensurePositiveSeeds;
    ensureNegativeSeeds = vi.fn();
    expandNode = expandNode;
  },
}));

const baseSnapshot: GraphSnapshot = {
  nodes: [
    {
      id: 1,
      kind: NodeKind.Work,
      key: '100',
      title: 'Seed Work',
      wordCount: 5000,
      estimatedFreq: 1,
      calibratedFreq: null,
      explored: true,
    },
    {
      id: 2,
      kind: NodeKind.Tag,
      key: 'rare-tag',
      estimatedFreq: 2,
      calibratedFreq: null,
      explored: false,
    },
    {
      id: 3,
      kind: NodeKind.Work,
      key: '200',
      title: 'Neighbor',
      wordCount: 3000,
      estimatedFreq: 1,
      calibratedFreq: null,
      explored: false,
    },
  ],
  edges: [
    { workNodeId: 1, tagNodeId: 2 },
    { workNodeId: 3, tagNodeId: 2 },
  ],
  authorEdges: [],
};

function makePropagationPayload(nodeCount: number) {
  const values = Array.from({ length: nodeCount }, (_, i) => (i + 1) * 0.01);
  return {
    relevance: values,
    authority: values.map((v) => v * 2),
    precision: values.map((v) => v + 0.5),
    expectedInfo: values.map((v) => v * 0.1),
    iterations: { relevance: 5, authority: 10 },
    debug: {
      priorLog: values.map((v) => Math.log(v + 1)),
      tagPriorLog: values.map((v) => v * 0.2),
      initialAuthority: values.map((v) => v * 1.5),
    },
  };
}

describe('searchTrace helpers', () => {
  it('buildNodeTable aligns indices with CSR node order', () => {
    const csr = buildCSR(baseSnapshot);
    const table = buildNodeTable(csr);

    expect(table).toHaveLength(csr.nodeCount);
    table.forEach((entry, index) => {
      expect(entry.index).toBe(index);
      expect(entry.id).toBe(csr.nodeByIndex[index].id);
      expect(entry.key).toBe(csr.nodeByIndex[index].key);
    });
  });

  it('snapshotFrontier includes picked node even when outside top N', () => {
    const frontier: FrontierNode[] = Array.from({ length: 60 }, (_, i) => ({
      nodeId: i + 1,
      index: i,
      relevance: 1,
      authority: 1,
      precision: 1,
      expectedInfo: 60 - i,
    }));
    const picked = frontier[55];

    const snapshot = snapshotFrontier(frontier, picked, 50);

    expect(snapshot).toHaveLength(51);
    expect(snapshot.some((entry) => entry.nodeId === picked.nodeId)).toBe(true);
    expect(snapshot.find((entry) => entry.nodeId === picked.nodeId)?.rank).toBe(55);
  });

  it('snapshotPropagation round-trips without undefined fields', () => {
    const payload = makePropagationPayload(4);
    const snapshot = snapshotPropagation(payload);
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json) as typeof snapshot;

    expect(parsed.priorLog).toHaveLength(4);
    expect(parsed.tagPriorLog).toHaveLength(4);
    expect(parsed.initialAuthority).toHaveLength(4);
    expect(parsed.relevance).toEqual(payload.relevance);
    expect(Object.values(parsed).every((value) => value !== undefined)).toBe(true);
  });

  it('SearchTraceRecorder assigns monotonic step indices', () => {
    const recorder = new SearchTraceRecorder({ positive: [], negative: [] });
    const csr = buildCSR(baseSnapshot);

    recorder.recordStep({
      phase: 'cold-start',
      requestsUsed: 0,
      nodeTable: buildNodeTable(csr),
      graph: baseSnapshot,
      csr: {
        offsets: [...csr.offsets],
        neighbors: [...csr.neighbors],
        edgeWeights: [...csr.edgeWeights],
        rowOutFractions: [...csr.rowOutFractions],
      },
    });
    recorder.recordStep({
      phase: 'final',
      requestsUsed: 1,
      nodeTable: buildNodeTable(csr),
      graph: baseSnapshot,
      csr: {
        offsets: [...csr.offsets],
        neighbors: [...csr.neighbors],
        edgeWeights: [...csr.edgeWeights],
        rowOutFractions: [...csr.rowOutFractions],
      },
      propagation: snapshotPropagation(makePropagationPayload(csr.nodeCount)),
    });

    const trace = recorder.finish();
    expect(trace.steps.map((step) => step.stepIndex)).toEqual([0, 1]);
    expect(searchTraceInfo(trace)).toEqual({
      available: true,
      searchId: trace.searchId,
      stepCount: 2,
      nodeCount: csr.nodeCount,
    });
  });
});

describe('runQueryPropagation debug output', () => {
  it('returns priorLog, tagPriorLog, and initialAuthority when debug is true', () => {
    const result = runQueryPropagation({
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      rowOutFractions: new Float64Array([1, 1, 1, 1]),
      seedIndices: [0],
      workIndices: [0, 2],
      tagIndices: [1],
      authorIndices: [],
      authorWorkIndexEdges: [],
      wordCounts: [5000, null, null],
      nodeKinds: [NodeKind.Work, NodeKind.Tag, NodeKind.Work],
      alpha: 0.5,
      maxIterations: 100,
      tolerance: 1e-8,
      debug: true,
    });

    expect(result.debug).toBeDefined();
    expect(result.debug!.priorLog).toHaveLength(3);
    expect(result.debug!.tagPriorLog).toHaveLength(3);
    expect(result.debug!.initialAuthority).toHaveLength(3);
    expect(result.debug!.initialAuthority.some((v) => v > 0)).toBe(true);
  });

  it('omits debug output when debug is false', () => {
    const result = runQueryPropagation({
      offsets: [0, 1, 3, 4],
      neighbors: [1, 0, 2, 1],
      edgeWeights: [1, 1, 1, 1],
      rowOutFractions: new Float64Array([1, 1, 1, 1]),
      seedIndices: [0],
      workIndices: [0, 2],
      tagIndices: [1],
      authorIndices: [],
      authorWorkIndexEdges: [],
      wordCounts: [5000, null, null],
      nodeKinds: [NodeKind.Work, NodeKind.Tag, NodeKind.Work],
      alpha: 0.5,
      maxIterations: 100,
      tolerance: 1e-8,
    });

    expect(result.debug).toBeUndefined();
  });
});

describe('SearchOrchestrator tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expandNode.mockImplementation(async (node: { explored?: boolean }) => {
      node.explored = true;
    });
  });

  it('records cold-start, iterate, and final steps when tracing is enabled', async () => {
    const { SearchOrchestrator } = await import('@/src/search/orchestrator');

    let snapshot = structuredClone(baseSnapshot);
    vi.mocked(loadGraphSnapshot).mockImplementation(async () => structuredClone(snapshot));
    vi.mocked(runQueryPropagationViaWorker).mockImplementation(async () =>
      makePropagationPayload(snapshot.nodes.length),
    );
    vi.mocked(ensurePositiveSeeds).mockImplementation(async () => {
      snapshot = structuredClone(baseSnapshot);
    });
    vi.mocked(expandNode).mockImplementation(async (node) => {
      const tag = snapshot.nodes.find((n) => n.id === node.id);
      if (tag) tag.explored = true;
    });

    const orchestrator = new SearchOrchestrator({ traceEnabled: true });
    const progress: unknown[] = [];
    const result = await orchestrator.run(
      [{ kind: 'work', workId: '100', title: 'Seed Work', url: 'https://example.test/100' }],
      [],
      (payload) => progress.push(payload),
    );

    expect(result.trace).toBeDefined();
    const phases = result.trace!.steps.map((step) => step.phase);
    expect(phases).toContain('cold-start');
    expect(phases).toContain('iterate');
    expect(phases).toContain('final');

    const iterateWithAction = result.trace!.steps.filter(
      (step) => step.phase === 'iterate' && step.action?.expandedNode,
    );
    expect(iterateWithAction.length).toBeGreaterThan(0);
    expect(iterateWithAction[0]?.propagation?.priorLog.length).toBeGreaterThan(0);
    expect(
      iterateWithAction.some((step) => step.action?.expandedNode?.key === 'rare-tag'),
    ).toBe(true);
  });
});
